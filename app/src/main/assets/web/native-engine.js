/** A small JSON transport around the existing listening engine. No UI or animation. */
export function isNativeUiEnabled(android){
 try{return typeof android?.isNativeUiEnabled==='function'&&[true,'true'].includes(android.isNativeUiEnabled())}catch{return false}
}

export function nativeQuestionState(question,answer,index=0){
 const submitted=answer?.submitted===true,choice=answer?.choice||null,correct=question.answer||null;
 return {id:question.id,number:question.number??index+1,index,choice,submitted,answer:correct,
  correct:submitted&&correct?choice===correct:null,
  options:(question.options||[]).map(option=>({id:option.id,key:option.id,text:option.text,
   isSelected:choice===option.id,isCorrect:submitted&&!!correct&&correct===option.id,
   isWrong:submitted&&!!correct&&choice===option.id&&choice!==correct}))};
}

export function createNativeEngine({android,readCatalog,readState,readProgress,dispatch,clock=()=>performance.now(),progressInterval=250}){
 let ready=false,catalogJSON='',stateJSON='',progressJSON='',progressAt=-Infinity,lastCommand=null,queue=Promise.resolve();
 function send(name,value){try{if(typeof android?.[name]==='function'){android[name](JSON.stringify(value));return true}}catch(error){console.warn('Native bridge',name,error)}return false}
 const state=()=>({schemaVersion:1,ready,...readState()});
 const progress=()=>({schemaVersion:1,...readProgress()});
 function publishState(force=false){const value=state(),json=JSON.stringify(value);if(force||json!==stateJSON){if(send('onNativeState',value))stateJSON=json}return value}
 function publishCatalog(force=false){const value={schemaVersion:1,...readCatalog()},json=JSON.stringify(value);if(force||json!==catalogJSON){if(send('onNativeCatalog',value))catalogJSON=json}return value}
 function publishProgress(force=false){const now=clock();if(!force&&now-progressAt<progressInterval)return null;const value=progress(),json=JSON.stringify(value);if(force||json!==progressJSON){if(send('onNativeProgress',value)){progressAt=now;progressJSON=json}}return value}
 function toast(message){try{android?.onNativeToast?.(String(message))}catch{}publishState()}
 function command(action,payload={}){
  const execute=async()=>{
   try{
    if(typeof action!=='string'||!action)throw new Error('无效操作');
    const input=typeof payload==='string'?JSON.parse(payload):payload;
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('无效操作参数');
    if(action==='resync'){publishCatalog(true);publishState(true);publishProgress(true)}
    else{await dispatch(action,input);publishState();publishProgress(true)}
    lastCommand={action,ok:true};return lastCommand;
   }catch(error){lastCommand={action,ok:false,error:String(error?.message||error)};toast(lastCommand.error);return lastCommand}
  };
  const result=queue.then(execute,execute);queue=result.then(()=>undefined,()=>undefined);return result;
 }
 return {publishState,publishCatalog,publishProgress,command,toast,
  setReady(value=true){ready=!!value;publishCatalog();publishState();publishProgress(true)},
  snapshot(){return {catalog:{schemaVersion:1,...readCatalog()},state:state(),progress:progress(),lastCommand}}};
}
