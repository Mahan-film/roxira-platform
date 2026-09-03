

from src.roxira_manager.mission_control.mission.mission import Mission
from src.roxira_manager.mission_control.planner.mission_planner import MissionPlanner



mission=Mission().create(

"Repair Smart Judge Architecture",

"legal"

)


print(mission)


print(

MissionPlanner().plan(

mission

)

)

