import {test,expect} from '@playwright/test';

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function mockAccount(page){
 const user={id:id(1),email:'browser-test@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{username:'browser_test'},user_metadata:{}};
 const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'},'test'].map(v=>typeof v==='string'?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 await page.addInitScript(({user,token})=>localStorage.setItem('expensive.supabase.auth.v1',JSON.stringify({user,access_token:token,refresh_token:'mock-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'})),{user,token});
 const data={
  profiles:[{id:id(2),name:'personal',balance:1000,created_at:'2026-01-01'}],
  people:[{id:id(3),profile_id:id(2),name:'Alex'}],debts:[],expenses:[],categories:[{id:id(4),name:'Food',sort_order:0}],
  trips:[{id:id(5),profile_id:id(2),name:'Weekend',budget:500,personal_budget:200,starts_on:'2026-10-26',ends_on:'2026-10-28',completed:false,created_at:'2026-10-26'}],
  trip_members:[{trip_id:id(5),person_id:id(3)}],trip_entries:[],
 };
 const calls=[];let fail=false,wait=null;
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin==='http://127.0.0.1:3210')return route.continue();
  if(url.pathname.startsWith('/auth/v1/'))return route.fulfill({json:user});
  if(!url.pathname.startsWith('/rest/v1/'))return route.abort();
  const table=url.pathname.split('/').pop(),body=req.postDataJSON();calls.push({table,method:req.method(),body});
  if(url.pathname.includes('/rpc/')){
   if(wait)await wait;
   if(fail){fail=false;return route.fulfill({status:503,json:{message:'Temporary connection problem',code:'unavailable'}});}
   if(table==='save_trip_budgets'){
    data.trips.push({id:body.p_id,profile_id:body.p_profile,name:body.p_name,budget:body.p_budget,personal_budget:body.p_personal_budget,starts_on:body.p_start,ends_on:body.p_end,completed:false,created_at:new Date().toISOString()});
    data.trip_members.push(...body.p_people.map(person_id=>({trip_id:body.p_id,person_id})));
   }else if(table==='add_trip_expense'||table==='edit_trip_expense'){
    const entry={id:body.p_id,trip_id:body.p_trip||id(5),reason:body.p_reason,amount:body.p_amount,payer:body.p_payer,shares:body.p_shares,category_id:body.p_category,created_at:new Date().toISOString(),version:1};
    if(table==='edit_trip_expense')data.trip_entries=data.trip_entries.filter(e=>e.id!==body.p_id);
    data.trip_entries.push(entry);
   }
   return route.fulfill({status:204});
  }
  if(req.method()==='POST'){data[table].push(body);return route.fulfill({status:201,json:null});}
  let rows=data[table]||[];
  for(const [key,value]of url.searchParams)if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));
  return route.fulfill({json:rows});
 });
 return {data,calls,failNext:()=>{fail=true;},hold:()=>{let release;wait=new Promise(r=>{release=r;});return ()=>{wait=null;release();};}};
}

test('trip form saves once and inline add-person does not submit or lose edits',async({page})=>{
 const api=await mockAccount(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/trips');await page.getByRole('button',{name:'+ new trip'}).click();
 const form=page.getByRole('dialog');await expect(form.locator('form')).toHaveCount(0);
 await form.getByLabel('name',{exact:true}).fill('Coast');
 await form.getByLabel('total trip budget').fill('=250*2');await form.getByLabel('your personal budget').fill('=100+20');
 await form.getByPlaceholder('search or add a person').fill('Taylor');
 await form.getByRole('button',{name:'+ add “Taylor”'}).click();
 await expect(form.getByRole('button',{name:'Taylor',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(api.calls.filter(c=>c.table==='save_trip_budgets')).toHaveLength(0);
 await form.getByRole('button',{name:'save',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Coast',exact:true})).toBeVisible();
 const saves=api.calls.filter(c=>c.table==='save_trip_budgets');expect(saves).toHaveLength(1);
 expect(saves[0].body).toMatchObject({p_budget:500,p_personal_budget:120,p_name:'Coast'});
 expect(saves[0].body.p_people).toHaveLength(1);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`expense saves and retries stay reliable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});const api=await mockAccount(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/trips');await page.getByRole('button',{name:/Weekend/}).click();
 await page.getByRole('button',{name:'+ log expense'}).click();const form=page.getByRole('dialog');
 await form.getByLabel('what for?').fill('Lunch');await form.getByLabel('total amount').fill('=20+80');
 await form.getByRole('button',{name:'Food',exact:true}).click();
 await expect(form.getByRole('button',{name:'Food',exact:true})).toHaveAttribute('aria-pressed','true');
 api.failNext();await form.getByRole('button',{name:'save',exact:true}).click();
 await expect(form.getByRole('alert')).toContainText('Temporary connection problem');
 await expect(form.getByLabel('what for?')).toHaveValue('Lunch');
 await expect(form.getByRole('button',{name:'Food',exact:true})).toHaveAttribute('aria-pressed','true');
 const release=api.hold();await form.getByRole('button',{name:'save',exact:true}).click();
 await expect(form.getByLabel('total amount')).toBeDisabled();
 await form.evaluate(element=>{
  element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 });
 await page.keyboard.press('Escape');await expect(form).toBeVisible();
 expect(api.calls.filter(c=>c.table==='add_trip_expense')).toHaveLength(2);
 release();await expect(form).toHaveCount(0);
 const expense=page.getByRole('button',{name:'Edit Lunch'});await expect(expense).toBeVisible();
 const saves=api.calls.filter(c=>c.table==='add_trip_expense');expect(saves[0].body.p_id).toBe(saves[1].body.p_id);
 expect(saves[1].body).toMatchObject({p_amount:100,p_shares:{me:50,[id(3)]:50},p_category:id(4)});
 expect(api.calls.filter(c=>c.table==='categories')).toHaveLength(1);
 expect(api.calls.filter(c=>c.table==='trips')).toHaveLength(1);
 await expense.click();await expect(form.getByLabel('custom shares')).not.toBeChecked();
 await form.getByLabel('total amount').fill('120');await form.getByRole('button',{name:'save',exact:true}).click();
 await expect(form).toHaveCount(0);expect(api.calls.filter(c=>c.table==='edit_trip_expense')[0].body.p_amount).toBe(120);
 expect(errors).toEqual([]);
});

test('offline save keeps entered values and submits once after reconnecting',async({page,context})=>{
 const api=await mockAccount(page);
 await page.goto('/trips');await page.getByRole('button',{name:/Weekend/}).click();
 await page.getByRole('button',{name:'+ log expense'}).click();const form=page.getByRole('dialog');
 await form.getByLabel('what for?').fill('Train');await form.getByLabel('total amount').fill('=30*2');
 await context.setOffline(true);await form.getByRole('button',{name:'save',exact:true}).click();
 await expect(form.getByRole('alert')).toContainText('offline');
 await expect(form.getByLabel('total amount')).toHaveValue('=30*2');
 expect(api.calls.filter(c=>c.table==='add_trip_expense')).toHaveLength(0);
 await context.setOffline(false);await form.getByRole('button',{name:'save',exact:true}).click();
 await expect(form).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit Train'})).toBeVisible();
 expect(api.calls.filter(c=>c.table==='add_trip_expense')).toHaveLength(1);
});
