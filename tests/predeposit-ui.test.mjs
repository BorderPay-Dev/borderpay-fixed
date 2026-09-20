import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:4173/tests/fixtures/invoice-ui.html');
 await page.getByRole('heading',{name:'Invoice & Agreement Hub'}).waitFor();
 await page.getByLabel('Continue a saved draft').selectOption('draft-1');
 await page.getByText('GBP is strictly B2B.',{exact:false}).waitFor();
 assert.equal(await page.getByText('12345678').count(),0);
 await page.screenshot({path:'/tmp/predeposit-pdf-qa/merchant-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Download invoice',exact:true}).waitFor();
 await page.getByRole('button',{name:'B2B agreement',exact:true}).click();
 await page.getByLabel('Approved agreement template').selectOption('v1');
 await page.getByRole('button',{name:'Check invoice & documents',exact:true}).click();
 await page.getByText('Review is processing.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download invoice & payment details'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Download invoice',exact:true}).count(),2);
 await page.evaluate(()=>window.__setInvoiceStatus('action_required'));
 await page.getByText('The contract amount or currency differs from the invoice.').waitFor({timeout:15000});
 const submitted=await page.evaluate(()=>window.__invoiceCalls.filter(c=>c.action==='submit').length);assert.equal(submitted,1);
 await page.getByRole('button',{name:'Branding & signature'}).click();await page.getByLabel("Authorized signer's name").waitFor();
 await page.screenshot({path:'/tmp/predeposit-pdf-qa/merchant-signature.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Invoice builder',exact:true}).click();
 await page.screenshot({path:'/tmp/predeposit-pdf-qa/merchant-desktop.png',fullPage:true});
 console.log('PASS: mobile and desktop invoice workspace, saved draft, GBP notice, submission, flagged feedback and locked bank details');
}finally{await browser.close();}
