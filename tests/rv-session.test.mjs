import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRvSession, findRvSessionPage, waitForRvSession } from '../server/providers/rv-session.mjs';

function page({ url='https://www.rvonline.mx/', authenticated=false, search=false, roleLabel='' }={}) {
  return { url:()=>url,
    locator:selector=>({count:async()=>selector==='a[href*="action=logout" i]' && authenticated ? 1 : 0}),
    // No visible "Log out" role is provided, reproducing the previous wait's failure.
    getByRole:(role,options)=>({first(){return this;},isVisible:async()=>role==='tab'&&search&&options.name.test(roleLabel)}) };
}

test('RV session uses the portal sign-out target even when its text is translated or hidden',async()=>{
  const signed=page({authenticated:true,search:true,roleLabel:'Hoteles'});
  assert.equal(await hasRvSession(signed),true);
  assert.equal(await findRvSessionPage([signed]),signed);
});

test('RV session follows the authenticated new tab rather than the original login tab',async()=>{
  const original=page(); const signed=page({authenticated:true,search:true,roleLabel:'Hotels'});
  assert.equal(await findRvSessionPage([original,signed]),signed);
  assert.equal(await waitForRvSession({pages:()=>[original,signed]},{timeoutMs:100}),signed);
});

test('RV session rejects login screens, signed-out search pages, unrelated origins and pages without a searcher',async()=>{
  const candidates=[page(),page({search:true,roleLabel:'Hotels'}),page({url:'https://unrelated.example/',authenticated:true,search:true,roleLabel:'Hotels'}),page({authenticated:true})];
  assert.equal(await findRvSessionPage(candidates),null);
});

test('RV session reports progress and finishes with a bounded timeout',async()=>{
  const messages=[];
  await assert.rejects(waitForRvSession({pages:()=>[page()]},{timeoutMs:35,pollMs:2,logEveryMs:0,log:m=>messages.push(m)}),/No se detectó una sesión/);
  assert.ok(messages.length>0);
  assert.ok(messages.every(m=>m.includes('Esperando detectar')));
});

test('RV session stops when the local browser window is closed',async()=>{
  await assert.rejects(waitForRvSession({pages:()=>[]},{timeoutMs:100}),/Se cerró la ventana/);
});
