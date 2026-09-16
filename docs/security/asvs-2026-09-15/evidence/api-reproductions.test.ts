import { assert, assertEquals } from "@std/assert";
import { harness, ADMIN, PLAIN, SAFE_ADDR, proposerToken } from "../../../../api/tests/app-helpers.ts";
import { transferLog } from "../../../../api/tests/helpers.ts";
import { TOKENS, ADMIN_SESSION_TTL_SECS } from "../../../../api/config.ts";
import { createPinata } from "../../../../api/services/pinata.ts";
import { loadConfig } from "../../../../api/config.ts";
import { clientIp } from "../../../../api/middleware/ip.ts";
import { Hono } from "hono";

Deno.test("ASVS-01: forum URL path replaces the validated host before fetch", async () => {
  const resolved: string[] = [];
  const h = await harness({fetch: () => Response.json({title:"Controlled forum title"})});
  try {
    h.deps.resolve = (host) => {
      resolved.push(host);
      return Promise.resolve(host === "forum.example.com" ? [["93.184.216.34"],null] : [null,"non-public"]);
    };
    const token = await proposerToken(h);
    const response = await h.req("/api/initiatives", {method:"POST",token,json:{title:"",discourseUrl:"https://forum.example.com//127.0.0.1:8443/admin"}});
    const target = h.fetchLog.find(r => r.url.includes("8443"))?.url;
    assertEquals(target,"https://127.0.0.1:8443/admin.json");
    assert(resolved.length > 0 && resolved.every(host => host === "forum.example.com"));
    console.log(JSON.stringify({resolved,target,finalStatus:response.status,network:"mocked; no request sent"}));
  } finally { h.close(); }
});

Deno.test("ASVS-03: unauthenticated first writer poisons immutable donation consent", async () => {
  const h = await harness();
  try {
    const rfp=await h.db.rfps.insert({title:"ASVS local fixture",status:"approved",safeAddress:SAFE_ADDR,goalUsd:1000});
    const tx="0x"+"ab".repeat(32);
    const forged={version:"a".repeat(64),address:ADMIN,acceptedAt:new Date((h.clock.now-60)*1000).toISOString()};
    const first=await h.req("/api/donate/confirm",{method:"POST",json:{slug:rfp.slug,txHash:tx,terms:forged}});
    assertEquals(first.status,200);
    assertEquals((await h.db.terms.get(tx))?.address,ADMIN);
    h.script.receipts[tx]={status:"0x1",blockNumber:"0x10",logs:[transferLog(TOKENS.USDC[0],PLAIN,SAFE_ADDR,25000000n)]};
    const second=await h.req("/api/donate/confirm",{method:"POST",json:{slug:rfp.slug,txHash:tx,terms:{...forged,version:"b".repeat(64),address:PLAIN}}});
    const result=await second.json();
    const saved=await h.db.terms.get(tx);
    assertEquals(result.status,"confirmed");
    assertEquals(saved?.address,ADMIN);
    assertEquals(saved?.version,forged.version);
    console.log(JSON.stringify({firstStatus:first.status,secondStatus:second.status,donationStatus:result.status,consentStillForged:true,network:"in-memory KV and fake chain"}));
  } finally {h.close();}
});

Deno.test("ASVS-04: existing ordinary session becomes admin and exceeds admin TTL", async () => {
  const h=await harness();
  try {
    const ordinary=await h.mint(PLAIN);
    assertEquals((await h.req("/api/admin/admins",{token:ordinary})).status,403);
    await h.deps.admins.add(PLAIN);
    h.clock.now += ADMIN_SESSION_TTL_SECS + 60;
    assertEquals((await h.req("/api/admin/admins",{token:ordinary})).status,200);
    const session=await h.db.sessions.get(ordinary);
    assertEquals(session?.isAdmin,false);
    console.log(JSON.stringify({ageSeconds:ADMIN_SESSION_TTL_SECS+60,persistedIsAdmin:session?.isAdmin,adminEndpointStatus:200,remainingSeconds:session!.expiresAt-h.clock.now}));
  } finally {h.close();}
});

Deno.test("ASVS-07: four PNG marker bytes pass upload content validation", async () => {
  let uploaded=0;
  const p=createPinata(loadConfig({PINATA_JWT:"test-fixture-only"}),async (_u,init) => {
    uploaded=((init?.body as FormData).get("file") as File).size;
    return Response.json({data:{cid:"bafy"+"a".repeat(50)}});
  });
  const [cid,err]=await p.uploadImage(new Uint8Array([0x89,0x50,0x4e,0x47]),1024,"asvs");
  assert(cid);assertEquals(err,null);assertEquals(uploaded,4);
  console.log(JSON.stringify({acceptedBytes:uploaded,realImage:false,network:"mocked Pinata"}));
});

Deno.test("ASVS-09: combined-server request dispatch drops Deno client address", async () => {
  const app = new Hono();
  app.use("*",clientIp(false));app.get("/",c=>c.json({ip:c.get("ip")}));
  const req=new Request("https://initiatives.thedao.fund/");
  const without=await (await app.fetch(req)).json();
  const withInfo=await (await app.fetch(req,{remoteAddr:{transport:"tcp",hostname:"203.0.113.42",port:12345}})).json();
  assertEquals(without.ip,"?");assertEquals(withInfo.ip,"203.0.113.42");
  console.log(JSON.stringify({withoutInfo:without.ip,withInfo:withInfo.ip,productionTrustProxy:"unverified"}));
});
