// One-time admin migration, never imported by the app. Defaults to read-only.
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {cert,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
for(const file of ['.env','.env.local'])if(existsSync(file))for(const [k,v] of Object.entries(parseEnv(readFileSync(file,'utf8'))))process.env[k]??=v;
const apply=process.argv.includes('--apply');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const firebase=initializeApp({credential:cert({projectId:process.env.FIREBASE_PROJECT_ID,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')})});
const auth=getAuth(firebase),firestore=getFirestore(firebase);
const mappings=[];
for(let offset=0;;offset+=1000){
 const result=await admin.rpc('auth_migration_accounts').range(offset,offset+999);
 if(result.error)throw new Error('Run supabase-auth-prepare.sql first.');
 mappings.push(...result.data);if(result.data.length<1000)break;
}
const existing=[];
for(let page=1;;page++){
 const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
 if(error)throw new Error('Could not list Supabase users.');
 existing.push(...data.users);if(data.users.length<1000)break;
}
const plan=[];
for(const row of mappings){
 const user=await auth.getUser(row.firebase_uid);
 const identity=await firestore.collection('identities').doc(user.uid).get();
 const username=identity.data()?.username;
 if(!user.emailVerified||!user.email||user.disabled||!username)throw new Error(`Account ${row.app_user_id} needs manual verification/disabled-account review; nothing has been written.`);
 const byId=existing.find(u=>u.id===row.app_user_id),byEmail=existing.find(u=>u.email?.toLowerCase()===user.email.toLowerCase());
 if((byId&&byId.email?.toLowerCase()!==user.email.toLowerCase())||(byEmail&&byEmail.id!==row.app_user_id))throw new Error(`Account ${row.app_user_id} has an ownership conflict; stop and resolve it manually.`);
 plan.push({...row,email:user.email,username,exists:!!byId});
}
console.log(`${plan.length} mapped accounts checked; ${plan.filter(p=>!p.exists).length} need Supabase creation. ${apply?'Applying':'Read-only dry run'}.`);
if(apply){
 for(const row of plan){
  if(!row.exists){
   const {data,error}=await admin.auth.admin.createUser({id:row.app_user_id,email:row.email,email_confirm:true,password:randomBytes(48).toString('base64url')});
   if(error||data.user?.id!==row.app_user_id)throw new Error(`Creation failed for ${row.app_user_id}. Stop; do not cut over.`);
  }
  const {error}=await admin.rpc('auth_migration_username',{p_id:row.app_user_id,p_username:row.username});
  if(error)throw new Error(`Username migration failed for ${row.app_user_id}. Fix conflict and rerun before cutover.`);
 }
 console.log('Account IDs and usernames preserved. No email was sent. Run the cutover SQL after backup/validation; users then request a password reset.');
}
