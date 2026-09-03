

from src.roxira_manager.master_agent.feedback.feedback_loop import FeedbackLoop


f=FeedbackLoop()


print(
f.evaluate(
{
"status":"ENGINEERING_READY"
}
)
)


print(
f.evaluate(
{
"status":"FAILED"
}
)
)


print(
f.history()
)

