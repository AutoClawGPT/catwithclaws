/* GET /api
   Real Pons v2 launches on Robinhood Chain. There is no Pons API key.
   Source: factory TokenLaunched logs, then name/symbol/logo/supply from each token.
   /api?before=<block> pages backward. /api?limit=20 (max 30).
*/
const RPCS = [
  'https://rpc.mainnet.chain.robinhood.com',
  'https://robinhood-rpc.publicnode.com',
];
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const TOPIC = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const OURS = 'CWCAI';

const SEL = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  supply: '0x18160ddd',
  logo: '0xfb7f21eb',
  description: '0x7284e416',
};

function checksum(addr) {
  const h = addr.toLowerCase().replace(/^0x/, '');
  // checksum is nice but not required for links; keep lowercase 0x + 40
  return '0x' + h;
}

function wordAddr(word) {
  return checksum('0x' + word.slice(-40));
}

function decodeString(hex) {
  if (!hex || hex === '0x') return '';
  const b = Buffer.from(hex.slice(2), 'hex');
  if (b.length < 64) return '';
  const len = Number(b.readBigUInt64BE(32 + 24));
  if (!Number.isFinite(len) || len < 0 || len > 2000) return '';
  return b.subarray(64, 64 + len).toString('utf8').replace(/\0/g, '').trim();
}

async function rpc(method, params) {
  let last = 'rpc failed';
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) { last = j.error.message || 'rpc error'; continue; }
      return j.result;
    } catch (e) {
      last = e.message || String(e);
    }
  }
  throw new Error(last);
}

async function batchCalls(items) {
  const body = items.map((it, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: it }));
  let last = 'batch failed';
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rows = await r.json();
      if (!Array.isArray(rows)) { last = 'batch not an array'; continue; }
      const out = new Array(items.length);
      for (const row of rows) out[row.id] = row.result || '0x';
      return out;
    } catch (e) {
      last = e.message || String(e);
    }
  }
  throw new Error(last);
}

async function logsBack(before, limit) {
  const head = before == null
    ? parseInt(await rpc('eth_blockNumber', []), 16)
    : before - 1;
  const found = [];
  let cursor = head;
  const floor = Math.max(0, head - 250000);
  while (found.length < limit && cursor >= floor) {
    const from = Math.max(floor, cursor - 8000);
    const logs = await rpc('eth_getLogs', [{
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + cursor.toString(16),
      address: FACTORY,
      topics: [TOPIC],
    }]);
    for (const log of logs) found.push(log);
    if (from === floor) break;
    cursor = from - 1;
  }
  found.sort((a, b) => parseInt(b.blockNumber, 16) - parseInt(a.blockNumber, 16));
  return { head, logs: found.slice(0, limit) };
}

function readLog(log) {
  const data = log.data.slice(2);
  const words = data.match(/.{64}/g) || [];
  return {
    token: wordAddr(log.topics[1]),
    curve: wordAddr(log.topics[2]),
    deployer: wordAddr(log.topics[3]),
    pairToken: words[0] ? wordAddr(words[0]) : null,
    launchConfigId: words[1] ? Number(BigInt('0x' + words[1])) : null,
    graduationThresholdWei: words[2] ? BigInt('0x' + words[2]).toString() : null,
    block: parseInt(log.blockNumber, 16),
    tx: log.transactionHash,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=180');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'GET only' }); return; }
  try {
    const q = req.query || {};
    const limit = Math.max(1, Math.min(30, parseInt(q.limit, 10) || 20));
    const before = q.before ? parseInt(q.before, 10) : null;
    if (q.before && !Number.isFinite(before)) {
      res.status(400).json({ ok: false, error: 'before must be a block number' });
      return;
    }
    const { head, logs } = await logsBack(before, limit);
    const rows = logs.map(readLog);
    const calls = [];
    for (const row of rows) {
      for (const sel of [SEL.name, SEL.symbol, SEL.decimals, SEL.supply, SEL.logo, SEL.description]) {
        calls.push([{ to: row.token, data: sel }, 'latest']);
      }
    }
    const results = calls.length ? await batchCalls(calls) : [];
    const tokens = rows.map((row, i) => {
      const base = i * 6;
      const name = decodeString(results[base]);
      const symbol = decodeString(results[base + 1]);
      const decimals = parseInt(results[base + 2] || '0x0', 16);
      const supplyWei = BigInt(results[base + 3] || '0x0').toString();
      const logo = decodeString(results[base + 4]);
      const description = decodeString(results[base + 5]);
      const sym = symbol.replace(/^\$/, '');
      return {
        ...row,
        name,
        symbol: sym,
        decimals: Number.isFinite(decimals) ? decimals : 18,
        supplyWei,
        logo,
        description,
        pons: 'https://www.ponsfamily.com/launchpad/' + row.token,
        explorer: 'https://robinhoodchain.blockscout.com/token/' + row.token,
        ours: sym.toUpperCase() === OURS,
      };
    });
    const oldest = tokens.length ? tokens[tokens.length - 1].block : null;
    res.status(200).json({
      ok: true,
      chainId: 4663,
      network: 'Robinhood Chain',
      factory: FACTORY,
      source: 'Pons v2 factory TokenLaunched, read from the public RPC. No Pons API key.',
      launchpad: 'https://www.ponsfamily.com/launchpad',
      ourSymbol: OURS,
      ourCoin: tokens.find((t) => t.ours) || null,
      head,
      nextBefore: oldest,
      tokens,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'chain read failed' });
  }
}
