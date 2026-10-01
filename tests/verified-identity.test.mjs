import test from 'node:test';
import assert from 'node:assert/strict';
import { requireVerifiedUser } from '../lib/identity/verified-user.mjs';
const claims={uid:'firebase-id',email:'owner@example.com',email_verified:true};
const user={uid:'firebase-id',email:'owner@example.com',emailVerified:true,disabled:false};
test('single-user lookup still enforces Firebase revocation boundaries and fails closed',()=>{
 const current={...user,tokensValidAfterTime:'2026-10-02T00:00:00.000Z'};
 const boundary=Date.parse(current.tokensValidAfterTime)/1000;
 assert.throws(()=>requireVerifiedUser({...claims,auth_time:boundary-1},current),{status:401});
 assert.doesNotThrow(()=>requireVerifiedUser({...claims,auth_time:boundary},current));
 assert.doesNotThrow(()=>requireVerifiedUser({...claims,auth_time:boundary+1},current));
 for(const auth_time of [undefined,NaN,'123']) assert.throws(()=>requireVerifiedUser({...claims,auth_time},current),{status:401});
 assert.throws(()=>requireVerifiedUser({...claims,auth_time:boundary},{...current,tokensValidAfterTime:'invalid'}),{status:401});
 assert.throws(()=>requireVerifiedUser({...claims,auth_time:boundary},{...current,disabled:true}),{status:403});
});
test('legacy enrollment requires matching, currently verified email and enabled identity',()=>{
 assert.doesNotThrow(()=>requireVerifiedUser(claims,user));
 for(const change of [{emailVerified:false},{disabled:true},{email:'other@example.com'},{uid:'other'},{email:null}])
  assert.throws(()=>requireVerifiedUser(claims,{...user,...change}),{status:403});
 assert.throws(()=>requireVerifiedUser({...claims,email_verified:false},user),{status:403});
});
test('verification email may be sent before verification but identity mismatch and disabled users remain denied',()=>{
 assert.doesNotThrow(()=>requireVerifiedUser({...claims,email_verified:false},{...user,emailVerified:false},false));
 assert.throws(()=>requireVerifiedUser(claims,{...user,disabled:true},false),{status:403});
 assert.throws(()=>requireVerifiedUser(claims,{...user,email:'someone@example.com'},false),{status:403});
});
