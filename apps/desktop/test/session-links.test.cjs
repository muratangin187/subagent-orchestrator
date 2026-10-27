const {test}=require('node:test');
const assert=require('node:assert/strict');
test('session links only accept exact task UUIDs and never external or file targets', async()=>{
 const {sessionLinkId}=await import('../src/session-links.mjs');
 const id='161c0520-1faf-4bea-a888-2bc252e1b470';
 assert.equal(sessionLinkId(`agent-workspace://session/${id}`),id);
 assert.equal(sessionLinkId(`AGENT-WORKSPACE://session/${id.toUpperCase()}`),id);
 for(const url of [undefined,'https://session/'+id,'agent-workspace://session/../../etc/passwd',`agent-workspace://session/${id}?x=1`,`agent-workspace://session/${id}/extra`,'agent-workspace://session/title','javascript:alert(1)']) assert.equal(sessionLinkId(url),null);
});
