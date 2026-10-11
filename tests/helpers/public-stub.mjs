import { readFile } from 'node:fs/promises';
const fixture = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
export const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
export const HL = '0x4bdf1130109e9c1bc921d8979ea66284d9c92f37';
/** A fetch over the captured fixtures for every public host the adapters use; fails on anything else, so a test proves no other call is made. */
export async function publicStub({ hl = 'hl-sol-short', mode = 'disabled', lamports = 3_219_600_000 } = {}) {
  const [state, funding, fees, meta, book, kamino, quote] = await Promise.all([fixture(hl), fixture('hl-funding-history'), fixture('hl-user-fees'), fixture('hl-meta'), fixture('hl-l2book'), fixture('kamino-obligations'), fixture('jupiter-quote')]);
  const calls = [];
  const json = (value) => Response.json(value);
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ host: target.host, path: target.pathname, type: body?.type ?? body?.method ?? null, method: init.method ?? 'GET' });
    if (target.host === 'api.hyperliquid.xyz') {
      if (target.pathname !== '/info') throw new Error('only the info endpoint is public read-only');
      switch (body.type) {
        case 'clearinghouseState': return json(state);
        case 'allMids': return json({ SOL: '109.695' });
        case 'userAbstraction': return json(mode);
        case 'vaultDetails': return json(null);
        case 'spotClearinghouseState': return json({ balances: [] });
        case 'fundingHistory': return json(funding);
        case 'userFees': return json(fees);
        case 'meta': return json(meta);
        case 'l2Book': return json(book);
        default: throw new Error(`unexpected info type ${body.type}`);
      }
    }
    if (target.host === 'solana-rpc.publicnode.com') return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
    if (target.host === 'api.kamino.finance' && target.pathname.endsWith('/reserves/metrics')) return json([{ reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', totalSupply: '120702201.4', totalBorrow: '112626977.24', supplyApy: '0.0468228385' }]);
    if (target.host === 'api.kamino.finance') return json(kamino);
    if (target.host === 'lite-api.jup.ag' && target.pathname.startsWith('/ultra/v1/balances/')) return json({ SOL: { uiAmount: 3.2196 }, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { uiAmount: 336.4 } });
    if (target.host === 'lite-api.jup.ag') return json(quote);
    throw new Error(`unexpected host ${target.host}`);
  };
  return { fetchImpl, calls };
}
