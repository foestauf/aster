import subprocess,json,hashlib,statistics,os,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve(); out.mkdir(parents=True,exist_ok=True); source_dir=Path(__file__).resolve().parent/'workloads'; compiler=root/'build/asterc'
configs=['c-O2','c-O3','c-lto','llvm']; names=['maps_int_set','maps_string_set']; commands=[]; binaries={}; results=[]
def run(cmd):
 p=subprocess.run([str(x) for x in cmd],cwd=root,capture_output=True,check=True)
 return p
for cfg in configs:
 for name in names:
  source=source_dir/(name+'.aster'); binary=out/(name+'-'+cfg)
  if cfg in ['c-O2','llvm']:
   cmd=[compiler,'build',source]+(['--backend=llvm'] if cfg=='llvm' else [])+['-o',binary]
  else:
   emit=[compiler,'build',source,'--emit=c']; cfile=out/(name+'.c');p=run(emit); assert not p.stderr,p.stderr;cfile.write_bytes(p.stdout);commands.append(list(map(str,emit)))
   cmd=['cc','-std=c11']+(['-O3'] if cfg=='c-O3' else ['-O2','-flto'])+['-Wall','-I'+str(root/'runtime'),cfile,root/'runtime/aster_rt.c','-o',binary]
  commands.append(list(map(str,cmd)));run(cmd);binaries[name,cfg]=binary
runner=out/'bench-runner';run(['cc','-std=c11','-O2','-Wall','-Wextra','-Werror',root/'scripts/bench-runner.c','-o',runner])
for name in names:
 for cfg in configs:results.append({'benchmark':name,'configuration':cfg,'samples':[]})
for rnd in range(11):
 for name in names:
  for cfg in configs[rnd%4:]+configs[:rnd%4]:
   metrics=out/'sample.json';p=run([runner,metrics,binaries[name,cfg]]);data=json.loads(metrics.read_text());expected=(source_dir/(name+'.expected')).read_bytes()
   assert p.stdout==expected,(name,cfg,p.stdout,expected)
   assert p.stderr==b'' and data['exitCode']==0 and data['signal']==0,(name,cfg,p.stderr,data)
   data.update(round=rnd,warmup=rnd==0,valid=True,stdoutSha256=hashlib.sha256(p.stdout).hexdigest());next(r for r in results if r['benchmark']==name and r['configuration']==cfg)['samples'].append(data)
 print(f'extra checked round {rnd}/10',flush=True)
for r in results:
 s=[v for v in r['samples'] if not v['warmup']]; ms=[v['elapsedMs'] for v in s];r.update(medianWallMs=statistics.median(ms),medianPeakRssKiB=statistics.median(v['peakRssKiB'] for v in s),minMs=min(ms),maxMs=max(ms));r['relativeSpread']=(max(ms)-min(ms))/r['medianWallMs']
report={'sourceRevision':run(['git','rev-parse','HEAD']).stdout.decode().strip(),'note':'New nonhistorical workloads, separately measured; not included in frozen five-workload geometric mean or historical gates. CPU 0; same toolchain and flags as repository harness. 1 checked warmup plus 10 checked timed rounds, rotating configs. Expected output computed independently using Python dict reference, including insertion-order churn.','commands':commands,'sources':{n:hashlib.sha256((source_dir/(n+'.aster')).read_bytes()).hexdigest() for n in names},'results':results,'ok':True}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
for r in results: print(r['benchmark'],r['configuration'],r['medianWallMs'],r['medianPeakRssKiB'],r['relativeSpread'])
