import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
const load=async path=>{
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2021}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
};
const {en}=await load('src/i18n/messages.ts');
const {htmlMessages,messageKey,slot}=await load('src/i18n/template.ts');
const failures=[];
for(const name of readdirSync('src').filter(name=>name.endsWith('.ts'))){
  const source=ts.createSourceFile(name,readFileSync('src/'+name,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=node=>{
    if(ts.isTaggedTemplateExpression(node)&&['h','m'].includes(node.tag.getText(source))){
      const template=node.template;
      const text=ts.isNoSubstitutionTemplateLiteral(template)?template.text:template.head.text+template.templateSpans.map((span,index)=>slot(index)+span.literal.text).join('');
      const keys=node.tag.getText(source)==='h'?htmlMessages(text):[messageKey(text).key];
      for(const key of keys)if(!Object.hasOwn(en,key))failures.push(`${name}:${source.getLineAndCharacterOfPosition(node.pos).line+1}: ${JSON.stringify(key)}`);
    }
    ts.forEachChild(node,visit);
  };visit(source);
}
for(const [source,translation] of Object.entries(en)){
  const slots=text=>[...text.matchAll(/\{\{(\d+)\}\}/g)].map(match=>match[1]).sort().join(',');
  if(slots(source)!==slots(translation))failures.push('Interpolation mismatch: '+source);
  if(!translation.trim())failures.push('Empty translation: '+source);
}
if(failures.length){console.error('Missing or invalid i18n messages:\n'+failures.join('\n'));process.exitCode=1;}
else console.log(`PASS ${Object.keys(en).length} translation entries; UI templates and interpolation slots are covered.`);
