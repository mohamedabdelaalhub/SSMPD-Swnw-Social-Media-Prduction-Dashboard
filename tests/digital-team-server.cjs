const {spawnSync}=require('node:child_process');
const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','test_digital_team_*.py'],{encoding:'utf8',timeout:30000});
process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');
if(run.error)console.error(run.error.message);
process.exit(run.status===0?0:1);
