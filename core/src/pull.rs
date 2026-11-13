//! Pull fetches first, then requires an explicit merge for divergent histories.
use crate::{gitcli::Git, model::*};
impl Git {
    pub fn pull_checked(
        &self,
        expected: Option<&str>,
        track: bool,
        confirmed: Option<&PullPlan>,
    ) -> Result<PullResult, String> {
        self.prepare_pull(expected, track)?;
        let plan = if let Some(plan) = confirmed {
            let current = self.pull_plan()?;
            if current.branch != plan.branch
                || current.head != plan.head
                || current.upstream != plan.upstream
                || current.upstream_oid != plan.upstream_oid
                || current.token != plan.token
            {
                return Err("Der Pull-Stand wurde geändert. Bitte Pull erneut starten.".into());
            }
            current
        } else {
            let fetched = self.run_result(["fetch"]);
            if !fetched.ok {
                return Ok(PullResult {
                    result: fetched,
                    plan: None,
                    conflicts: vec![],
                });
            }
            // An external checkout/merge during network access invalidates this request.
            self.prepare_pull(expected, false)?;
            let plan = self.pull_plan()?;
            if plan.ahead > 0 && plan.behind > 0 {
                return Ok(PullResult {
                    result: CommandResult {
                        ok: false,
                        code: 1,
                        stdout: String::new(),
                        stderr: String::new(),
                    },
                    plan: Some(plan),
                    conflicts: vec![],
                });
            }
            plan
        };
        // Never use an implicit rebase or alter the user's pull configuration.
        let result = if confirmed.is_some() {
            self.run_result([
                "merge",
                "--ff",
                "--no-edit",
                "-m",
                &format!("Merge {} into {}", plan.upstream, plan.branch),
                &plan.upstream_oid,
            ])
        } else {
            self.run_result(["merge", "--ff-only", "--no-edit", &plan.upstream_oid])
        };
        let conflicts = self
            .conflicted_files()?
            .into_iter()
            .map(|f| f.path)
            .collect();
        Ok(PullResult {
            result,
            plan: None,
            conflicts,
        })
    }
    fn pull_plan(&self) -> Result<PullPlan, String> {
        let snapshot = self.snapshot()?;
        let branch = self
            .branches()?
            .into_iter()
            .find(|b| b.is_current)
            .ok_or("Aktueller Branch nicht verfügbar.")?;
        if !branch.tracking_known {
            return Err("Tracking-Branch nicht verfügbar. Bitte Fetch ausführen.".into());
        }
        let upstream = self
            .run(["rev-parse", "--symbolic-full-name", "@{upstream}"])?
            .trim()
            .to_owned();
        let upstream_oid = self
            .run(["rev-parse", "--verify", "@{upstream}^{commit}"])?
            .trim()
            .to_owned();
        Ok(PullPlan {
            branch: snapshot.head_branch.ok_or("Kein Branch ausgecheckt.")?,
            upstream,
            upstream_oid,
            head: snapshot.head,
            ahead: branch.ahead,
            behind: branch.behind,
            token: self.workflow_token()?,
        })
    }
}
