

from src.roxira_manager.dev_agent.architecture_audit.dependency.graph import DependencyGraph

from src.roxira_manager.dev_agent.architecture_audit.dependency.cycle_detector import CycleDetector



graph=DependencyGraph().build()


cycles=CycleDetector().find(graph)



print({

"modules":
len(graph),

"cycles":
cycles,

"cycle_count":
len(cycles)

})

