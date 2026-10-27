const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = (id, parentTaskId, status = 'running') => ({id, parentTaskId, title:id, status, updatedAt:1});
test('conversation workflow defaults to three direct children, expands to four in parent order', async () => {
 const {workflowTree} = await import('../src/workflow-tree.mjs');
 const tasks = [t('a','assistantA'),t('b','assistantA'),t('c','assistantA'),t('nested','b'),t('unrelated','assistantB'),t('orphan','missing')];
 const rows = workflowTree(tasks,'assistantA',true);
 assert.deepEqual(rows.filter(r=>r.depth===0).map(r=>r.task.id),['a','b','c']);
 assert.deepEqual(rows.map(r=>[r.task.id,r.depth]),[['a',0],['b',0],['nested',1],['c',0]]);
 assert.deepEqual(workflowTree(tasks,'b').map(r=>r.task.id),['nested']);
 assert.equal(workflowTree(tasks,undefined).length,0);
});
test('active branches retain inactive ancestors, omit terminal-only branches, and exclude cycles/orphans', async () => {
 const {workflowTree} = await import('../src/workflow-tree.mjs');
 const tasks=[t('a','root','completed'),t('b','a','cancelled'),t('deep','b'),t('done','root','completed'),t('cancel','root','cancelled'),t('failed','root','failed'),t('orphan','missing'),t('loop','loop'),t('root','deep')];
 const rows=workflowTree(tasks,'root',true);
 assert.deepEqual(rows.map(r=>[r.task.id,r.depth]),[['a',0],['b',1],['deep',2]]);
 assert.deepEqual(rows[2].path,['a','b']);
 assert.equal(workflowTree(tasks,'root').length,6);
});
test('preference reload is connection and conversation scoped; missing or inaccessible storage defaults off', async () => {
 const {workflowPreferenceKey:key,loadWorkflowPreference:load} = await import('../src/workflow-tree.mjs');
 const storage=new Map(); storage.getItem=storage.get.bind(storage);
 storage.set(key('serverA','A'),'true');
 assert.equal(load(storage,key('serverA','A')),true);
 assert.equal(load(storage,key('serverA','B')),false);
 assert.equal(load(storage,key('serverB','A')),false);
 assert.equal(load({getItem(){throw Error('denied')}},'key'),false);
});
