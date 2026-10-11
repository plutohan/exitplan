import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoPortfolio,defaultConstraints,planExit}from'../web/engine.mjs';
test('all feasible plans across scenario grid conserve equity net of explicit fees',()=>{
 let checked=0;
 for(const target of [1,100,2000,4498.75,5000,10000,20000])for(const preserveHedge of [true,false])for(const preserveSolQuantity of [true,false])for(const maxNewDebt of [0,3000]){
  const p=createDemoPortfolio(), c={...defaultConstraints(),target,preserveHedge,preserveSolQuantity,maxNewDebt};
  const r=planExit(p,c);
  for(const x of r.feasible){checked++;
   const before=p.solana.sol*p.solana.solPrice+p.solana.lending.usdc+p.hyperliquid.collateral;
   const after=x.solAfter*p.solana.solPrice+x.lendingAfter+x.hlCollateralAfter+x.netCash-x.newDebt;
   assert.ok(Math.abs(before-after-x.fees)<=0.011,`Conservation ${x.id}`);
   assert.ok(x.netCash>=target-0.001);assert.ok(x.newDebt<=maxNewDebt);assert.ok(x.hlBufferAfter>=c.minHlBuffer-0.001);
   if(preserveHedge)assert.ok(Math.abs(x.netSolExposure)<0.000001);
   if(preserveSolQuantity)assert.equal(x.solAfter,p.solana.sol);
  }
 }
 assert.ok(checked>500);
});
