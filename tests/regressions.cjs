const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function load(name, tail, extra = {}) {
  const ctx = { module: {exports:{}}, require, URL, Buffer, AbortSignal, setTimeout, clearTimeout, ...extra };
  vm.runInNewContext(fs.readFileSync(__dirname+'/../'+name,'utf8')+'\n'+tail,ctx);
  return ctx.module.exports;
}
const feeds = load('api/feeds.js','module.exports={parseRss,pickLink};');
const source={id:'news',name:'News',url:'https://example.com/rss'};
const rss='<rss><item><title>Power news</title><link><![CDATA[https://publisher.example/story?a=1&amp;b=2]]></link><pubDate>not a date</pubDate></item></rss>';
assert.equal(feeds.parseRss(rss,source)[0].url,'https://publisher.example/story?a=1&b=2');
assert.equal(feeds.parseRss(rss,source)[0].publishedAt,null);
assert.equal(feeds.parseRss('<item><title>Missing URL</title></item>',source).length,0);
assert.equal(feeds.pickLink('<link>javascript:alert(1)</link>'),'');
assert.equal(feeds.pickLink('<link rel="self" href="https://example.com/rss"/><link rel="alternate" href="https://example.com/story"/>'),'https://example.com/story');
assert.equal(feeds.pickLink('<link>https://news.google.com/rss/articles/ABC?oc=5</link>'),'https://news.google.com/rss/articles/ABC?oc=5');
let calls=0;
const article=load('api/article.js','module.exports={handler:module.exports,isPublicAddress,decodedPublisher};',{fetch:async()=>{calls++;return new Response('<html><title>Power update</title><article><p>'+ 'Public power news. '.repeat(80)+'</p></article></html>',{headers:{'content-type':'text/html'}});}});
assert.equal(article.decodedPublisher([["wrb.fr","Fbv4je",JSON.stringify(["garturlres","https://publisher.example/story?a=1&b=2"])]]),'https://publisher.example/story?a=1&b=2');
assert.equal(article.decodedPublisher([["wrb.fr","Fbv4je",null]]),'');
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1']) assert.equal(article.isPublicAddress(ip),false,ip);
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};}
(async()=>{
  let r=response();await article.handler({method:'GET',query:{url:'http://127.0.0.1'}},r);assert.equal(r.statusCode,502);assert.equal(calls,0);
  r=response();await article.handler({method:'GET',query:{url:'https://8.8.8.8/story'}},r);assert.equal(r.statusCode,200);assert.match(r.body,/<base href=/);assert.match(r.headers['Content-Security-Policy'],/sandbox/);
  r=response();await article.handler({method:'GET',query:{url:'https://8.8.8.8/story',view:'reader'}},r);assert.equal(r.statusCode,200);assert.match(r.body,/In-dashboard reader/);
  const failing=load('api/article.js','',{fetch:async()=>new Response('blocked',{status:403})});
  r=response();await failing({method:'GET',query:{url:'https://8.8.8.8/story'}},r);assert.equal(r.statusCode,502);
  const html=fs.readFileSync(__dirname+'/../index.html','utf8');assert.match(html,/data-theme="light"/);
  const exp=fs.readFileSync(__dirname+'/../js/experience.js','utf8');assert.match(exp,/theme: "light"/);assert.doesNotMatch(exp,/localStorage.getItem\("ikedc-theme"\)/);
  console.log('PASS: RSS/Atom URLs, missing/unsafe URLs, invalid dates, public-target checks, publisher/reader responses, failure status, light launch defaults.');
})().catch(e=>{console.error(e);process.exitCode=1;});
