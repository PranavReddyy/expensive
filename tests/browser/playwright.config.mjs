import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:'*.spec.mjs',fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:3210',headless:true},
 webServer:{command:'npm run start -- --port 3210',url:'http://127.0.0.1:3210',reuseExistingServer:false,timeout:60000},
});
