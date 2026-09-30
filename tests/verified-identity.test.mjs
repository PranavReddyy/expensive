import test from 'node:test';
import assert from 'node:assert/strict';
import { requireVerifiedUser } from '../lib/identity/verified-user.mjs';
const claims={uid:'firebase-id',email:'owner@example.com',email_verified:true};
const user={uid:'firebase-id',email:'owner@example.com',emailVerified:true,disabled:false};
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
