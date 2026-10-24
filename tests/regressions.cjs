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
  // Broader channels: Nigeria-only tabs, worldwide GIS / GeoAI / AI-ML tabs, X posts
  const rssOf=(items)=>'<rss>'+items.map(([t,l,d])=>`<item><title>${t}</title><link>${l}</link><pubDate>${d||'Fri, 23 Oct 2026 10:00:00 GMT'}</pubDate><description>${t}</description></item>`).join('')+'</rss>';
  const fakeFetch=async(url)=>{
    url=String(url);
    if(url.includes('api.x.com')) return new Response(JSON.stringify({data:[{id:'111',text:'GeoAI model maps solar farms from satellite imagery',author_id:'9',created_at:'2026-10-24T08:00:00Z'}],includes:{users:[{id:'9',username:'geoai_lab'}]}}),{headers:{'content-type':'application/json'}});
    if(url.includes('punchng.com')) return new Response(rssOf([['Ikeja Electric restores supply to Agege feeders','https://punchng.com/a'],['Super Eagles win friendly','https://punchng.com/b']]));
    if(url.includes('bing.com')&&url.includes('en-NG')) return new Response(rssOf([['Grid collapse hits power supply in the UK','https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.co.uk%2Fgrid'],['TCN restores national grid after collapse in Nigeria','https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.ng%2Fgrid']]));
    if(url.includes('esri.com')) return new Response(rssOf([['New ArcGIS spatial analysis tools for utility network','https://www.esri.com/x'],['New ArcGIS spatial analysis tools for utility network - Esri','https://dup.example/x']]));
    if(url.includes('gl=US')) return new Response(rssOf([['Geospatial digital twin for city mapping in Germany','https://example.de/gis']]));
    return new Response('<rss></rss>');
  };
  const feeds2=load('api/feeds.js','module.exports={unwrapLink,channelKeeps,loadSource,SOURCES};',{fetch:fakeFetch,Response,URLSearchParams,AbortController,process:{env:{X_BEARER_TOKEN:'test'}}});
  assert.equal(feeds2.unwrapLink('https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.ng%2Fstory&c=1'),'https://example.ng/story');
  const src=(id)=>feeds2.SOURCES.find((x)=>x.id===id);
  const power=src('google-power'), gis=src('google-gis'), geoai=src('google-geoai');
  assert.equal(feeds2.channelKeeps({title:'Grid collapse hits power supply in the UK',summary:''},power,{region:'global'}),false);
  assert.equal(feeds2.channelKeeps({title:'TCN restores national grid after collapse in Nigeria',summary:''},power,{region:'global'}),true);
  assert.equal(feeds2.channelKeeps({title:'Geospatial digital twin for city mapping in Germany',summary:''},gis,{region:'global'}),true);
  const ikejaRes=await feeds2.loadSource(src('ikeja'),{text:{},x:{}});
  assert.ok(ikejaRes.items.some((it)=>it.title.startsWith('Ikeja Electric restores')&&it.sourceName==='Ikeja Electric · Punch'));
  assert.ok(!ikejaRes.items.some((it)=>/Super Eagles/.test(it.title)));
  const powerRes=await feeds2.loadSource(power,{text:{},x:{}});
  assert.ok(powerRes.items.some((it)=>it.url==='https://example.ng/grid'));
  assert.ok(!powerRes.items.some((it)=>it.url==='https://example.co.uk/grid'));
  const gisRes=await feeds2.loadSource(gis,{text:{},x:{}});
  assert.equal(gisRes.items.filter((it)=>/ArcGIS spatial analysis/.test(it.title)).length,1);
  assert.ok(gisRes.items.some((it)=>/Germany/.test(it.title)));
  const geoRes=await feeds2.loadSource(geoai,{text:{},x:{}});
  assert.ok(geoRes.items.some((it)=>it.url==='https://x.com/geoai_lab/status/111'&&it.sourceName==='GeoAI News · X @geoai_lab'));
  console.log('PASS: RSS/Atom URLs, missing/unsafe URLs, invalid dates, public-target checks, publisher/reader responses, failure status, light launch defaults, broader channels (Nigeria-only filter, outlet keywords, Bing unwrap, de-dupe, X posts).');
})().catch(e=>{console.error(e);process.exitCode=1;});
