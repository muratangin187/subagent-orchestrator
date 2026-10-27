import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationBatch} from '../src/workspace/notification-batch.js';
test('notification batches retain ordered overflow and bound escaped result digests',()=>{
 const notices=Array.from({length:20},(_,i)=>({offset:i+1,taskId:'task',runId:'run',status:'completed',summary:'x'.repeat(7000)}));
 const seen:number[]=[];
 while(seen.length<notices.length){const batch=notificationBatch(notices.slice(seen.length));assert.ok(batch.body.length<=48000);assert.ok(batch.notifications.length);seen.push(...batch.notifications.map(n=>n.offset))}
 assert.deepEqual(seen,notices.map(n=>n.offset));
 const huge=notificationBatch([{offset:21,taskId:'task',runId:'run',status:'waiting_question',summary:'\u0000'.repeat(100000),question:{id:'question-id',prompt:'x'.repeat(100000)}}]);
 assert.ok(huge.body.length<=48000);assert.match(huge.body,/question-id/);assert.match(huge.body,/"truncated":true/);
});
