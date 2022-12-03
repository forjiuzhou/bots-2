#!/usr/bin/env node
import { Bot, DingTalk, SpotFull, SpotReal, ccxt, t, FillParams, OHLCV, KLineWatcherRT, SpotSimpleTest } from 'litebot';

export
interface Params {
  fast_period: number;
  slow_period: number;
  stop: number;
  take: number;
}

export
interface Signal
extends OHLCV {
  sma_fast: number;
  sma_slow: number;
  diff: number;
  buy: boolean;
  sell: boolean;
}

export
class SMACross
extends Bot<OHLCV, Signal> {
  public constructor(private readonly executor: SpotFull, private readonly params: Params) {
    super();
  }

  public get length() {
    return this.params.slow_period + 1;
  }

  protected next(tcs: OHLCV[], queue: Signal[] = []): Signal[] {
    const result = queue.concat(tcs as Signal[]);
    const closed = result.filter((item) => item.closed);
    const source = closed.map((item) => item.close);
    const fast_line = t.sma(source, this.params.fast_period, true);
    const slow_line = t.sma(source, this.params.slow_period, true);
    closed.forEach((last, index) => {
      last.sma_fast = fast_line[index];
      last.sma_slow = slow_line[index];
      last.diff = last.sma_fast - last.sma_slow;
      last.buy = closed[index - 1]?.diff <= 0 && last.diff > 0;
      last.sell = closed[index - 1]?.diff >= 0 && last.diff < 0;
    });
    return result;
  }

  private stop(signal: Signal) {
    const stop_price = this.executor.Offset(this.params.stop);
    const take_price = this.executor.Offset(this.params.take);
    const need_stop = signal.close <= stop_price;
    const need_take = signal.close >= take_price;
    if (need_stop) this.executor.SellAll(signal.opened ? signal.close : stop_price);
    if (need_take) this.executor.SellAll(signal.opened ? signal.close : take_price);
    return need_stop || need_take;
  }

  protected exec(signal: Signal) {
    if (!signal.closed) this.queue.pop();
    if (this.stop(signal)) return;
    if (signal.sell) this.executor.SellAll(signal.close);
    else if (signal.buy) this.executor.BuyAll(signal.close);
  }
}

(async () => {
  if (require.main !== module) return;
  const secret = require('./.secret.json');
  const params = {
    name: '墙头草',
    symbol: 'ETH/USDT',
    timeframe: '2h',
    fast_period: 9,
    slow_period: 44,
    stop: 1,
    take: 1e6,
    interval: 1000,
    funds: 15,
    assets: 0,
  };
  FillParams(params);
  const notifier = new DingTalk(secret.notifier);
  const exchange = new ccxt.binance(secret.exchange);
  console.log('loading market...');
  await exchange.loadMarkets();
  const executor = new SpotSimpleTest();
  const bot = new SMACross(executor, params);
  new KLineWatcherRT().RunBot({ exchange, bot, ...params });
})();
