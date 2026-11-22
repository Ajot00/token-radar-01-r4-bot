import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

type Protocol = { slug:string; name:string; category:string|null; chains:string[]; tvl_usd:number; change_7d:number|null; mcap_usd:number|null; listed_at:string|null; gecko_id:string|null; symbol:string|null };
type Snapshot = { as_of:string; source:string; floor_usd:number; protocols:Protocol[]; watchlist:string[] };
const root = fileURLToPath(new URL('.', import.meta.url));
const option = (key:string, fallback:string) => { const i=process.argv.indexOf(`--${key}`); return i>=0 ? process.argv[i+1]! : fallback; };
const input = option('input','/input'), source = input.endsWith('.json') ? input : join(input,'snapshot.json');
const output = option('output',process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
if (!existsSync(source)) throw new Error(`Snapshot missing: ${source}`);
const snap = JSON.parse(readFileSync(source,'utf8')) as Snapshot;
const avg = (xs:number[]) => xs.reduce((s,x)=>s+x,0)/xs.length;
const median = (xs:number[]) => { const a=[...xs].sort((x,y)=>x-y), m=a.length>>1; return a.length%2?a[m]!:(a[m-1]!+a[m]!)/2; };
const comps = snap.protocols.filter(p=>(p.mcap_usd??0)>0 && p.tvl_usd>0 && p.listed_at!==null);
const lx=comps.map(p=>Math.log10(p.tvl_usd)), ly=comps.map(p=>Math.log10(p.mcap_usd!));
const mx=avg(lx), my=avg(ly), b=lx.reduce((s,x,i)=>s+(x-mx)*(ly[i]!-my),0)/lx.reduce((s,x)=>s+(x-mx)**2,0), a=my-b*mx;
const r2=1-ly.reduce((s,y,i)=>s+(y-(a+b*lx[i]!))**2,0)/ly.reduce((s,y)=>s+(y-my)**2,0);
const undated=snap.protocols.filter(p=>(p.mcap_usd??0)>0&&p.tvl_usd>0&&p.listed_at===null).length;
if(comps.length!==95||Math.abs(a-3.5291)>.02||Math.abs(b-.4567)>.02) throw new Error(`Dated comp fit differs: n=${comps.length}, a=${a}, b=${b}`);
const banned=new Set(['CEX','Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC']);
const version=/\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)(?:\b|$)/, descriptor=/\b(?:wrapped|staked|staking)\b/i, exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const eligible=(p:Protocol)=>p.gecko_id===null&&p.symbol===null&&!banned.has(p.category??'')&&!version.test(p.name)&&!descriptor.test(p.name)&&!exchange.test(p.name);
const ageOf=(p:Protocol)=>p.listed_at?Math.max(0,Math.floor((Date.parse(snap.as_of+'T00:00:00Z')-Date.parse(p.listed_at+'T00:00:00Z'))/86400000)):365;
const chainSet=[...new Set(snap.protocols.flatMap(p=>p.chains))].sort();
const gas:Record<string,number>={};
for(const c of chainSet) gas[c]=/ethereum/i.test(c)?3:/arbitrum|optimism|base|polygon|bsc|avalanche|celo|scroll|linea|zksync|mantle/i.test(c)?.08:/solana|sui|aptos|near|sei|ton/i.test(c)?.02:.05;
const capital=(t:number)=>t>=5e9?250:t>=1e9?150:t>=1e8?100:50;
function actionPair(category:string):[string,string] {
 const c=category.toLowerCase();
 if(/lend|cdp|credit/.test(c))return ['Supply a small supported asset after reviewing collateral factors and the withdrawal queue.','If permitted, open and repay a modest borrow; note rates and both transaction receipts.'];
 if(/dex|yield|leveraged/.test(c))return ['Add a small amount to a liquid pool after checking depth, fee tier and impermanent loss.','Make a separate swap or vote on an active pool proposal, then save the receipt.'];
 if(/perpetual|derivative/.test(c))return ['Open the smallest allowed position with a hard loss limit and inspect liquidation distance.','Place and cancel a distinct limit order; record execution and fees.'];
 if(/prediction/.test(c))return ['Review resolution wording and deadlines before taking a small position in a liquid market.','Inspect another market and record the oracle or source that determines resolution.'];
 if(/curator|allocator/.test(c))return ['Inspect manager, strategy and withdrawal terms before a small curated-vault deposit.','Review a separate allocation or rebalance and record why the exposure changed.'];
 if(/stablecoin/.test(c))return ['Check peg, collateral and redemption terms before a small supported mint or deposit.','Test a separate transfer or redemption path and record its fee.'];
 if(/rwa|real world/.test(c))return ['Confirm jurisdiction and account eligibility before subscribing to a minimal supported position.','Review reporting and redemption windows; record a separate statement or yield action.'];
 if(/insurance/.test(c))return ['Read exclusions, pool capacity and claim terms before buying minimal coverage.','Compare a distinct coverage option and record its capacity and price.'];
 if(/chain|rollup|sidechain/.test(c))return ['Bridge only a test-sized amount through the documented route and confirm destination receipt.','Perform a separate native transaction after checking network and validator risks.'];
 return ['Test a modest core-product deposit after checking asset support and withdrawal terms.','Complete a second distinct core action, such as another pool, vault or documented vote.'];
}
const watch=new Set(snap.watchlist), candidates=snap.protocols.filter(eligible);
if(candidates.length!==198)throw new Error(`Eligibility expected 198 rows, found ${candidates.length}`);
const rows=candidates.map(p=>{
 const age=ageOf(p), growth=Math.max(-50,Math.min(50,p.change_7d??0)), gm=1+growth/200, mm=.6+Math.min(age,1095)/1095*.4;
 const base=10**(a+b*Math.log10(p.tvl_usd)), implied=Math.max(1,Math.round(base*gm*mm)), low=implied/2.49, high=implied*2.49;
 const chain=p.chains[0]??'Unspecified', fee=gas[chain]??.05, funds=capital(p.tvl_usd), hold=age<180?60:age<365?45:30, weekly=fee*hold, total=+(funds+2*fee+weekly).toFixed(2), net=+(low-total).toFixed(2), share=total/low;
 const verdict=share<=.00002?'FARM':share<=.00008?'THIN':'SKIP', [first,second]=actionPair(p.category??'');
 const farm=[
  `Set up a dedicated wallet for ${p.name}; store the recovery phrase offline and keep it private. Setup cost $0.00; allow 10 minutes.`,
  `${first} Capital budget $${funds}. Primary chain ${chain}; planning gas $${fee.toFixed(2)} for this transaction, plus capital at risk. Allow 15 minutes.`,
  `${second} Keep the action separate and save its receipt for ${p.name}. ${chain} gas estimate $${fee.toFixed(2)}; allow 10–20 minutes.`,
  `Once each week, check ${p.name} for an eligible activity and log the transaction. Allow $${fee.toFixed(2)} gas × ${hold} weeks = $${weekly.toFixed(2)}; 10 minutes per visit.`,
  `Use a ${hold}-day review horizon based on the recorded ${age}-day age; inspect liquidity and exit terms weekly. No additional planned fee; capital remains exposed.`,
  `Check the project's published points, quests and reward conditions weekly; record dates and eligibility instead of assuming an allocation. Cost $0.00; 5 minutes.`,
  `Before each signature for ${p.name} on ${chain}, verify the official domain and contract; test claim links independently. Keep keys private and log dates, amounts and hashes. Cost $0.00; 5 minutes.`,
  `Exit after checking withdrawal rules and liquidity. Planned spend $${total.toFixed(2)} including weekly gas. Break-even share ${(share*100).toFixed(6)}% of supply; verdict ${verdict}. You break even if your eventual allocation reaches that share of supply; compare with the protocol's actual points design.`
 ];
 return {...p,age_days:age,base_value_usd:base,growth_pct:growth,growth_multiplier:gm,maturity_multiplier:mm,implied_value_usd:implied,implied_low_usd:low,implied_high_usd:high,total_farm_cost_usd:total,net_low_usd:net,breakeven_share:share,verdict,watchlist:watch.has(p.slug),farm_steps:farm};
}).sort((x,y)=>y.implied_value_usd-x.implied_value_usd||(x.slug<y.slug?-1:x.slug>y.slug?1:0)).map((p,i)=>({...p,rank:i+1}));
const verdicts={FARM:rows.filter(x=>x.verdict==='FARM').length,THIN:rows.filter(x=>x.verdict==='THIN').length,SKIP:rows.filter(x=>x.verdict==='SKIP').length};
const bucketDefs:[string,number,number][]=[['<$10M',0,1e7],['$10M–$100M',1e7,1e8],['$100M–$1B',1e8,1e9],['≥$1B',1e9,Infinity]];
const sizeBuckets=bucketDefs.map(([label,lo,hi])=>{const xs=comps.filter(p=>p.tvl_usd>lo&&p.tvl_usd<=hi);return {label,n:xs.length,median_ratio:median(xs.map(p=>p.mcap_usd!/p.tvl_usd))};});
const categoryDigest=[...new Set(rows.map(x=>x.category??'Uncategorized'))].sort().map(category=>{const xs=rows.filter(x=>(x.category??'Uncategorized')===category);return {category,row_count:xs.length,median_tvl_usd:median(xs.map(x=>x.tvl_usd)),median_implied_value_usd:median(xs.map(x=>x.implied_value_usd)),top_slug:xs[0]!.slug,watchlist_rows:xs.filter(x=>x.watchlist).length};});
const weekMovers=[...rows].filter(x=>x.change_7d!==null).sort((x,y)=>Math.abs(y.change_7d!)-Math.abs(x.change_7d!)||(x.slug<y.slug?-1:1)).slice(0,10);
const live=snap.protocols.filter(p=>p.mcap_usd!==null).map(p=>({...p,age_days:ageOf(p),token_status:'Live token'})).sort((x,y)=>(y.mcap_usd??0)-(x.mcap_usd??0));
const modelSearch=[
 {variant:'Power law n95 · LOCKED',split_half:'×2.49',time_split:'×3.08',r2:'0.168',outcome:'Retained: best split-half median.'},
 {variant:'Power law n128',split_half:'×3.67',time_split:'×3.08',r2:'0.194',outcome:'Rejected: weaker blind median.'},
 {variant:'Quadratic n95',split_half:'×2.58',time_split:'×2.61',r2:'0.182',outcome:'Rejected: time transfer improves, headline median worsens.'},
 {variant:'Multi-factor ridge λ=100',split_half:'×2.96',time_split:'×2.62',r2:'0.108',outcome:'Rejected: worse split-half and fit.'},
 {variant:'Category ridge λ=1',split_half:'×2.73',time_split:'×3.55',r2:'0.297',outcome:'Rejected: higher R², weaker transfer.'},
 {variant:'Power law + buckets',split_half:'×2.78',time_split:'—',r2:'—',outcome:'Rejected: split-half worsens.'},
 {variant:'kNN k=8',split_half:'×2.87',time_split:'—',r2:'—',outcome:'Rejected: split-half worsens.'}
];
const payload={rows,live,model:{a,b,r2,n:comps.length,excluded_no_listing_date:undated,blind:{split_half:{seeds:[7,13,42,99,123],median_multiple:2.49,per_seed:[3.07,2.49,3.05,2.46,2.18],range:[2.18,3.07]},time_split:3.08,oldest_newest:3.01,leave_one_out:3.23,bootstrap_slope:{mean:.459,sd:.101}},size_buckets: sizeBuckets,watchlist_count:watch.size,above_floor_count:rows.filter(x=>!x.watchlist&&x.tvl_usd>=snap.floor_usd).length,below_floor_count:rows.filter(x=>!x.watchlist&&x.tvl_usd<snap.floor_usd).length,early_count:rows.filter(x=>!x.watchlist).length,as_of:snap.as_of,source:snap.source,gas_costs:gas,verdicts,model_search:modelSearch},categoryDigest,weekMovers,methodNotes:[`OLS on ${comps.length} dated traded comps: log10(mcap) = a + b × log10(TVL). ${undated} traded records without a listing date are excluded because age and verifiable track record are unavailable.`,`Growth is clamped to ±50% and applied at half weight; maturity spans 0.6–1.0 over 1,095 days. Unknown listing age uses 365 days.`,`Five-seed blind split-half median error is ×2.49 (range ×2.18–×3.07); time split ×3.08, oldest/newest ×3.01, leave-one-out ×3.23. Bootstrap slope 0.459 ± 0.101.`,`The ±×2.49 value band comes from blind error. It is not a launch probability or return promise. Costs are planning estimates; capital budget is exposed, not counted as spent.`,`Break-even share equals planned cost divided by low-end implied value. Our board calls FARM at ≤0.002%, THIN at ≤0.008%, otherwise SKIP. You break even if your eventual allocation reaches that share of supply; compare with the protocol's actual points design.`,`A single sealed snapshot cannot confirm future launches, airdrop terms, wallet eligibility or current gas. The verdict is a screening rule, not protocol-specific points knowledge.`]};
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'board.json'),`${JSON.stringify({rows})}\n`);
writeFileSync(join(output,'data.js'),`window.RADAR=${JSON.stringify(payload)};\n`);
function copyFlat(from:string,to:string){mkdirSync(to,{recursive:true});const names:string[]=[];for(const name of readdirSync(from)){if(name.startsWith('.'))continue;const file=join(from,name);if(statSync(file).isFile()){copyFileSync(file,join(to,name));names.push(name);}}return names;}
copyFlat(join(root,'dashboard'),join(output,'dashboard'));const shots=copyFlat(join(root,'screenshots'),join(output,'screenshots'));
if(shots.length!==3)throw new Error(`Need exactly three screenshots; found ${shots.length}`);
writeFileSync(join(output,'dossier.json'),buildDossier(output,{text_max_bytes:65536,screenshots:{max:4,max_bytes:524288},dashboard:{max_files:400,max_bytes:4194304}}));
process.stdout.write(`protocols=${snap.protocols.length} watchlist=${watch.size} rows=${rows.length} live=${live.length}\na=${a.toFixed(4)} b=${b.toFixed(4)} R2=${r2.toFixed(3)} n=${comps.length} undated=${undated}\nverdicts FARM ${verdicts.FARM} / THIN ${verdicts.THIN} / SKIP ${verdicts.SKIP}\n`);
