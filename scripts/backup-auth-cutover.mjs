// Operator-only local backup. Never prints database credentials or user data.
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,chmodSync,statSync} from 'node:fs';
const project='ttzcbcgpxeldgkgeldap';
const config=spawnSync('supabase',['db','dump','--linked','--project-ref',project,'--dry-run'],{encoding:'utf8',timeout:120000});
if(config.status!==0)throw new Error('Could not obtain a temporary database connection.');
const env={...process.env,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'20'};
for(const line of config.stdout.split('\n')){
 const match=line.match(/^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=(".*")$/);
 if(match)env[match[1]]=JSON.parse(match[2]);
}
if(!env.PGPASSWORD||env.PGUSER!==`cli_login_postgres.${project}`)throw new Error('Unexpected backup connection.');
const root='/Users/Pranav/Downloads/expensive-backups';
mkdirSync(root,{recursive:true,mode:0o700});
const dir=mkdtempSync(root+'/auth-cutover-');chmodSync(dir,0o700);
const file=dir+'/before-cutover.dump';
process.umask(0o077);
const dump=spawnSync('/opt/homebrew/opt/postgresql@17/bin/pg_dump',['--no-password','--verbose','--lock-wait-timeout=15000','--format=custom','--role=postgres','--schema=public','--schema=app_private','--schema=auth','--file='+file],{env,encoding:'utf8',timeout:300000});
if(dump.status!==0){
 const reason=(dump.stderr||String(dump.error||'Unknown error')).replaceAll(env.PGPASSWORD,'[redacted]');
 throw new Error('Backup failed; no migration should be applied. '+reason);
}
chmodSync(file,0o600);
const verify=spawnSync('/opt/homebrew/opt/postgresql@17/bin/pg_restore',['--list',file],{encoding:'utf8'});
if(verify.status!==0||!verify.stdout.includes('TABLE DATA public profiles')||!verify.stdout.includes('TABLE DATA auth users'))throw new Error('Backup verification failed.');
console.log(JSON.stringify({backup:file,bytes:statSync(file).size,verified:true}));
