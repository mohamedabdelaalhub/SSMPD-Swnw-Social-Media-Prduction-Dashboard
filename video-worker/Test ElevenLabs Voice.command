#!/bin/bash
python3 "$HOME/SSMPDVideoWorker/worker.py" --test-voice
printf '\nاضغط Enter للإغلاق...'
read -r ssmpd_close
