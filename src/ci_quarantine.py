"""Files under src/ that match test_*.py but must not be collected by pytest.

pytest imports a file to collect it, so a marker cannot help when the import itself has
side effects. Listing them here keeps them out of collection entirely. Paths are relative
to src/. src/test_ci_quarantine_guard.py fails if a new side-effecting test_*.py appears
without being listed, and if a listed file no longer exists.
"""

from __future__ import annotations

# Scripts, not tests: they run agents, git operations, patches or network calls at import
# time (e.g. repair_engine/autonomous_executor calls the `opencode` agent on
# legal_drafter.py). Rewrite one as real test functions, then remove it from this list.
SCRIPTS: tuple[str, ...] = (
    "automation/test_factory_engines.py",
    "legal_intelligence/test_legal_suite.py",
    "roxira_manager/agent_runtime_connector/tests/test_runtime.py",
    "roxira_manager/autonomous_core/tests/test_autonomous_core.py",
    "roxira_manager/autonomous_runtime/tests/test_runtime.py",
    "roxira_manager/control_plane/tests/test_control_plane.py",
    "roxira_manager/dev_agent/agent_ecosystem/tests/test_registry.py",
    "roxira_manager/dev_agent/agent_router/test_router.py",
    "roxira_manager/dev_agent/architecture_audit/dependency/tests/test_dependency.py",
    "roxira_manager/dev_agent/architecture_audit/tests/test_audit.py",
    "roxira_manager/dev_agent/architecture_audit/v2/tests/test_duplicate.py",
    "roxira_manager/dev_agent/autonomous_controller/tests/test_controller.py",
    "roxira_manager/dev_agent/autonomous_engine/tests/test_executor.py",
    "roxira_manager/dev_agent/autonomous_loop/tests/test_controller.py",
    "roxira_manager/dev_agent/autonomous_loop/tests/test_loop.py",
    "roxira_manager/dev_agent/autonomous_patch/tests/test_patch_executor.py",
    "roxira_manager/dev_agent/capability_router/tests/test_router.py",
    "roxira_manager/dev_agent/contract_intelligence/tests/test_contract.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/api_contract_engine/test_api_contract.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/contract_engine/test_contract_engine.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/method_engine/test_method_engine.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/type_engine/test_type_engine.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/v2/test_v2.py",
    "roxira_manager/dev_agent/engineering_agent/intelligence/v3/test_v3.py",
    "roxira_manager/dev_agent/engineering_intelligence/tests/test_change_impact.py",
    "roxira_manager/dev_agent/engineering_intelligence/v2/tests/test_patch_system.py",
    "roxira_manager/dev_agent/engineering_supervisor/tests/test_supervisor.py",
    "roxira_manager/dev_agent/error_intelligence/tests/test_error_engine.py",
    "roxira_manager/dev_agent/external_agents/test_external_agents.py",
    "roxira_manager/dev_agent/git_safety/tests/test_git_guard.py",
    "roxira_manager/dev_agent/orchestrator/tests/test_orchestrator.py",
    "roxira_manager/dev_agent/patch_engine/guard/tests/test_guard.py",
    "roxira_manager/dev_agent/patch_engine/tests/test_patch_engine.py",
    "roxira_manager/execution_sandbox/tests/test_sandbox.py",
    "roxira_manager/external_gateway/tests/test_gateway.py",
    "roxira_manager/master_agent/autonomy/tests/test_manager.py",
    "roxira_manager/master_agent/core/tests/test_master_core.py",
    "roxira_manager/master_agent/feedback/tests/test_feedback.py",
    "roxira_manager/master_agent/memory/tests/test_memory.py",
    "roxira_manager/master_agent/orchestration/tests/test_orchestrator.py",
    "roxira_manager/master_agent/runtime/tests/test_executor.py",
    "roxira_manager/master_agent/superintelligence/tests/test_super_agent.py",
    "roxira_manager/master_agent/tests/test_master_agent.py",
    "roxira_manager/master_agent/tool_registry/tests/test_registry.py",
    "roxira_manager/master_agent/v10/tests/test_master_v10.py",
    "roxira_manager/master_agent/v11/tests/test_master_v11.py",
    "roxira_manager/master_agent/v12/tests/test_master_v12.py",
    "roxira_manager/master_agent/v2/tests/test_master_v2.py",
    "roxira_manager/master_agent/v3/tests/test_master_v3.py",
    "roxira_manager/master_agent/v4/tests/test_master_v4.py",
    "roxira_manager/master_agent/v5/tests/test_master_v5.py",
    "roxira_manager/master_agent/v6/tests/test_master_v6.py",
    "roxira_manager/master_agent/v7/tests/test_master_v7.py",
    "roxira_manager/master_agent/v8/tests/test_master_v8.py",
    "roxira_manager/master_agent/v9/tests/test_master_v9.py",
    "roxira_manager/mission_control/orchestrator/tests/test_orchestrator.py",
    "roxira_manager/mission_control/tests/test_mission.py",
    "roxira_manager/parallel_mission/tests/test_manager.py",
    "roxira_manager/real_agents/tests/test_real_agents.py",
    "roxira_manager/repair_engine/autonomous_executor/tests/test_executor.py",
    "roxira_manager/repair_engine/bridge/tests/test_bridge.py",
    "roxira_manager/repair_engine/code_executor/tests/test_code_executor.py",
    "roxira_manager/repair_engine/executor/tests/test_executor.py",
    "roxira_manager/repair_engine/orchestrator/tests/test_autonomous_repair.py",
    "roxira_manager/repair_engine/patch_apply/tests/test_patch_apply.py",
    "roxira_manager/repair_engine/patch_writer/tests/test_patch_writer.py",
    "roxira_manager/repair_engine/test_intelligence/contracts/tests/test_contract_generator.py",
    "roxira_manager/repair_engine/test_intelligence/discovery/tests/test_discovery.py",
    "roxira_manager/repair_engine/tests/test_repair.py",
    "roxira_manager/repair_engine/transaction/tests/test_transaction.py",
    "roxira_manager/repair_engine/verified_mutation/tests/test_mutation.py",
    "roxira_manager/scheduler/tests/test_scheduler.py",
    "roxira_manager/swarm_executor/tests/test_swarm.py",
    "roxira_manager/workspaces/tests/test_registry.py",
)

# Implementation modules that happen to be named test_* (TestRunner, TestDiscovery...).
NOT_TESTS: tuple[str, ...] = (
    "roxira_manager/dev_agent/autonomous_engine/test_runner.py",
    "roxira_manager/dev_agent/engineering_agent/test_runner.py",
    "roxira_manager/repair_engine/test_intelligence/discovery/test_discovery.py",
    "roxira_manager/repair_engine/test_intelligence/test_selector.py",
    "roxira_manager/software_factory/testing/test_engine.py",
)

IGNORED: tuple[str, ...] = SCRIPTS + NOT_TESTS
