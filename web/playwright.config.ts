import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",fullyParallel:false,workers:1,timeout:60000,
  use:{baseURL:"http://127.0.0.1:3200",trace:"off",screenshot:"off",video:"off"},
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  webServer:[
    {command:"node tests/mock-supabase.mjs",url:"http://127.0.0.1:3201/health",reuseExistingServer:false},
    {command:"node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200",url:"http://127.0.0.1:3200/login",reuseExistingServer:false,timeout:120000,env:{SUPABASE_URL:"http://127.0.0.1:3201",SUPABASE_PUBLISHABLE_KEY:"synthetic-public-key",APP_ORIGIN:"http://127.0.0.1:3200"}}
  ]
});
