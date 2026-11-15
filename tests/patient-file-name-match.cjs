// Runs the Python unit tests of the local name matcher (server/patient_file_name_check/match.py).
const {spawnSync}=require('child_process'),path=require('path');
const py=spawnSync('python3',['--version']);if(py.status!==0){console.log('SKIP: python3 not available');process.exit(0);}
const r=spawnSync('python3',['-m','unittest','tests/test_patient_file_name_check.py'],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
process.stdout.write(r.stderr||'');process.exit(r.status);
