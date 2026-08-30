const {defineConfig,devices}=require('@playwright/test');

module.exports=defineConfig({
  testDir:'./tests/e2e',
  timeout:30000,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?'html':'line',
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'mobile-chromium',use:{...devices['Pixel 7']}},
    {name:'desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}}
  ],
  webServer:{command:'node tests/static-server.cjs',url:'http://127.0.0.1:4173/loan_tracker.html?qa=1',reuseExistingServer:!process.env.CI}
});
