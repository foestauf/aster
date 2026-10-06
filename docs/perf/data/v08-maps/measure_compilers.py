import subprocess,json,hashlib,statistics,os,sys
from pathlib import Path
out=Path(sys.argv[3]).resolve();out.mkdir(parents=True,exist_ok=True)
roots={'v08a':Path(sys.argv[1]).resolve(),'v08b':Path(sys.argv[2]).resolve()}; configs=['c-O2','c-O3','c-lto','llvm']; commands=[]; binaries={}; results=[]
def run(cmd,cwd):
 p=subprocess.run([str(x) for x in cmd],cwd=cwd,capture_output=True,check=True);return p
def sha(data):return hashlib.sha256(data).hexdigest()
source='packages/asterc-self/asterc.aster'
for ver,root in roots.items():
 compiler=root/'build/asterc'
 for cfg in configs:
  binary=out/(ver+'-'+cfg)
  if cfg=='c-O2':
   binary.write_bytes(compiler.read_bytes());binary.chmod(0o755);commands.append(['COPY',str(compiler),str(binary)])
  elif cfg=='llvm':
   cmd=[compiler,'build',source,'--backend=llvm','-o',binary];run(cmd,root);commands.append(list(map(str,cmd)))
  else:
   cmd=[compiler,'build',source,'--emit=c'];p=run(cmd,root);assert not p.stderr;pfile=out/(ver+'.c');pfile.write_bytes(p.stdout);commands.append(list(map(str,cmd)))
   cmd=['cc','-std=c11']+(['-O3'] if cfg=='c-O3' else ['-O2','-flto'])+['-Wall','-I'+str(root/'runtime'),pfile,root/'runtime/aster_rt.c','-o',binary];run(cmd,root);commands.append(list(map(str,cmd)))
  binaries[ver,cfg]=binary
runner=out/'bench-runner';run(['cc','-std=c11','-O2','-Wall','-Wextra','-Werror',roots['v08a']/'scripts/bench-runner.c','-o',runner],roots['v08a'])
# Validate target emissions against the v0.8a compiler, independently of b's implementation.
oracles={}
for target,root in roots.items():
 p=run([binaries['v08a','c-O2'],'build',source,'--emit=c'],root);assert not p.stderr;oracles[target]=p.stdout;(out/(target+'-oracle.c')).write_bytes(p.stdout)
for target in roots:
 for mode in ['check','emit-c']:
  for ver in roots:
   for cfg in configs:results.append({'targetSource':target,'mode':mode,'compilerVersion':ver,'configuration':cfg,'samples':[]})
variants=[(ver,cfg) for cfg in configs for ver in roots]
for rnd in range(11):
 order=variants[rnd%len(variants):]+variants[:rnd%len(variants)]
 for target,root in roots.items():
  for mode in ['check','emit-c']:
   for ver,cfg in order:
    cmd=[binaries[ver,cfg],('check' if mode=='check' else 'build'),source]+(['--emit=c'] if mode=='emit-c' else [])
    metrics=out/'sample.json';p=run([runner,metrics,*cmd],root);data=json.loads(metrics.read_text());expected=(b'' if mode=='check' else oracles[target]);assert p.stdout==expected,(ver,cfg,target,mode,'stdout differs');assert not p.stderr and data['exitCode']==0 and data['signal']==0,(ver,cfg,target,mode,p.stderr,data)
    data.update(round=rnd,warmup=rnd==0,valid=True,stdoutSha256=sha(p.stdout));next(r for r in results if r['targetSource']==target and r['mode']==mode and r['compilerVersion']==ver and r['configuration']==cfg)['samples'].append(data)
 print(f'paired compiler round{rnd}/10',flush=True)
for r in results:
 ss=r['samples'][1:];ms=[s['elapsedMs'] for s in ss];r.update(medianWallMs=statistics.median(ms),medianPeakRssKiB=statistics.median(s['peakRssKiB'] for s in ss),minMs=min(ms),maxMs=max(ms));r['relativeSpread']=(max(ms)-min(ms))/r['medianWallMs']
report={'note':'Diagnostic: matched-source check and C emission, separate from native self-build gate. Both versions compile/check both frozen compiler-source trees. CPU0, serial, configurations and versions interleaved with rotating order. One checked warmup+10 checked timed rounds. Output oracle for each target obtained using the bootstrapped v0.8a compiler. C-O2 compiler copied from fixed-point bootstrapped build/asterc.','roots':{v:str(r) for v,r in roots.items()},'commands':commands,'binaries':{v+'/'+c:sha(p.read_bytes()) for (v,c),p in binaries.items()},'oracleHashes':{v:sha(b) for v,b in oracles.items()},'results':results,'ok':True};(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
for r in results:print(r['targetSource'],r['mode'],r['compilerVersion'],r['configuration'],r['medianWallMs'],r['medianPeakRssKiB'],r['relativeSpread'])
