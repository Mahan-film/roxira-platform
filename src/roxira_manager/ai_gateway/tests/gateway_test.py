

from src.roxira_manager.ai_gateway.gateway import AIGateway

from src.roxira_manager.ai_gateway.security import GatewaySecurity

from src.roxira_manager.ai_gateway.usage_logger import UsageLogger



gateway=AIGateway()


request=gateway.prepare_request(

"deepseek/deepseek-reasoner",

"تحلیل پرونده حقوقی",

"max"

)


print(request)



security=GatewaySecurity()

print(
security.check_request(request)
)



logger=UsageLogger()

print(
logger.log(
"user_001",
request["model"],
3000
)
)

