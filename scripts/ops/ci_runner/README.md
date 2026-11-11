# CI self-hosted runner (roxira-ci)

1. On srv1 (root): `bash proxy_on_srv1.sh --dry-run`, then without the flag. Starts tinyproxy on
   127.0.0.1:3128 only; aborts if that port is held by something else.
2. On the new VM create an SSH key for user `runner` and authorise it on srv1.
3. Token (on your Mac): `gh api -X POST repos/Mahan-film/roxira-platform/actions/runners/registration-token --jq .token`
4. Copy `setup_runner.sh` to the VM, run as root: `RUNNER_TOKEN=... SRV1_HOST=<srv1 ip> bash setup_runner.sh`
   (try `--dry-run` first; the token expires in about an hour). It sets up docker, the autossh
   tunnel, proxy env, 2 runners (`roxira-ci-1/2`) and a weekly docker prune timer.
5. Switch CI: `gh variable set CI_RUNS_ON -b roxira-ci -R Mahan-film/roxira-platform`
6. Rollback: `gh variable delete CI_RUNS_ON -R Mahan-film/roxira-platform`

Security: self-hosted runners only on a PRIVATE repo. On a public repo a fork PR can run
arbitrary code on the VM and reach the tunnel to srv1.
