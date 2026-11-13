// Test control only; not an OS security boundary. Permit private Unix IPC.
const net=require('node:net');
const tls=require('node:tls');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  if((typeof first==='object'&&typeof first?.path==='string')||(typeof first==='string'&&first.startsWith('/')))return connect.apply(this,args);
  throw Error('Catalog audit forbids TCP connections');
};
tls.connect=()=>{throw Error('Catalog audit forbids TLS connections');};
require('node:module').syncBuiltinESMExports();
