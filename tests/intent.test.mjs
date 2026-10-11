import test from 'node:test'; import assert from 'node:assert/strict';
import {interpretIntent,validateConstraints}from'../server/intent.mjs';
const c={target:2000,maxNewDebt:0,minHlBuffer:1500,deadlineHours:24,preserveHedge:true,preserveSolQuantity:false};
test('missing credentials visibly disables AI without outbound request',async()=>{const r=await interpretIntent({text:'hello',currentConstraints:c},{},()=>{throw Error('must not call')});assert.equal(r.status,503);assert.equal(r.body.mode,'unavailable');});
test('valid constraints strip untrusted extra fields',()=>assert.deepEqual(validateConstraints({...c,recipient:'attacker',sign:true}),c));
for(const v of [NaN,Infinity,-1,'2000'])test('reject invalid target '+v,()=>assert.throws(()=>validateConstraints({...c,target:v})));
test('reject string booleans',()=>assert.throws(()=>validateConstraints({...c,preserveHedge:'false'})));
test('model output is proposal only',async()=>{const fake=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({constraints:c,questions:[],explanation:'조건 유지'})}]}]});const r=await interpretIntent({text:'2000',currentConstraints:c},{OPENAI_API_KEY:'test-not-secret',OPENAI_MODEL:'test-model'},fake);assert.equal(r.status,200);assert.equal(r.body.requiresConfirmation,true);});
test('refusal does not masquerade as parsed intent',async()=>{const r=await interpretIntent({text:'x',currentConstraints:c},{OPENAI_API_KEY:'test-not-secret',OPENAI_MODEL:'test'},async()=>Response.json({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]}));assert.equal(r.status,502);});
