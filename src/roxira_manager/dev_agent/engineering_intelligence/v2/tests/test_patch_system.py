

from src.roxira_manager.dev_agent.engineering_intelligence.v2.patch_planner import PatchPlanner

from src.roxira_manager.dev_agent.engineering_intelligence.v2.regression_guard import RegressionGuard



contract={

"valid":False,

"missing":[

"analysis"

]

}



patch=PatchPlanner().create_patch(contract)


print(patch)



print(
RegressionGuard().validate(patch)
)

