const {test}=require('node:test');
const a=require('node:assert/strict');
const handler=require('../api/index');
const {merge,view,validate,profilesFor,passwordRecord,passwordOk}=handler._test;
const cli=(id,colab)=>({id,colab,emp:'Empresa',st:'Lead',sv:[],pays:[],hist:[],et:{},fech:'',fim:''});
const state=()=>({colabs:[{id:1,nome:'Gabi',com:60},{id:2,nome:'Laura',com:60}],clients:[cli(10,1),cli(20,2)]});
const gabi={id:'gabi',role:'user',colabId:1,ownerId:'admin'};
test('consulta entrega somente carteira própria',()=>{const v=view(state(),gabi,[gabi]);a.deepEqual(v.clients.map(c=>c.id),[10]);a.equal(v.colabs.length,1);a.equal(v.users[0].passwordHash,undefined)});
test('bloqueia transferência e captura de cliente alheio',()=>{a.throws(()=>merge(state(),{clients:[cli(10,2)]},gabi),e=>e.status===403);a.throws(()=>merge(state(),{clients:[cli(20,1)]},gabi),e=>e.status===403)});
test('preserva clientes alheios e comissão ao gravar carteira própria',()=>{const next=merge(state(),{colabs:[{id:1,nome:'Gabi',com:100}],clients:[{...cli(10,1),emp:'Nova'}]},gabi);a.equal(next.colabs[0].com,60);a.equal(next.clients.find(c=>c.id===20).emp,'Empresa');a.equal(next.clients.find(c=>c.id===10).emp,'Nova')});
test('valida valores, IDs e status',()=>{const s=state();s.clients[0].pays=[{v:-1,pago:true}];a.throws(()=>validate(s));const d=state();d.clients.push(cli(10,1));a.throws(()=>validate(d));const x=state();x.clients[0].st='<img onerror=alert(1)>';a.throws(()=>validate(x))});
test('administrador pode transferir carteira',()=>{const s=state();s.clients[0].colab=2;a.equal(merge(state(),s,{role:'admin'}).clients[0].colab,2)});
test('senha usa hash e valida corretamente',()=>{const u={...passwordRecord('senha-super-segura-123')};a.equal(passwordOk(u,'senha-super-segura-123'),true);a.equal(passwordOk(u,'senha-errada'),false);a.equal(u.passwordHash.includes('senha-super'),false)});

test('ADM lista todas as contas sem expor senhas; colaborador vê só a própria',()=>{
  const admin={id:'admin',role:'admin',ownerId:'admin'};
  const otherAdmin={id:'other',role:'admin',ownerId:'other'};
  const otherUser={id:'other-user',role:'user',ownerId:'other',colabId:1,passwordHash:'secret',passwordSalt:'secret'};
  const store={users:[admin,gabi,otherAdmin,otherUser]};
  const result=view(state(),admin,profilesFor(store,admin));
  a.deepEqual(result.users.map(u=>u.id),['admin','gabi','other','other-user']);
  a.ok(result.users.every(u=>!('passwordHash' in u)&&!('passwordSalt' in u)));
  a.deepEqual(profilesFor(store,gabi),[gabi]);
});

test('foto de perfil aceita imagens limitadas e rejeita URLs ou SVG',()=>{
  const {validatePhoto}=handler._test;
  a.doesNotThrow(()=>validatePhoto(null));
  a.doesNotThrow(()=>validatePhoto('data:image/webp;base64,YWJj'));
  for(const photo of [undefined,{},'https://example.com/a.png','data:image/svg+xml;base64,YWJj','data:image/png;base64,'+'A'.repeat(180000)])a.throws(()=>validatePhoto(photo),e=>e.status===400);
});
