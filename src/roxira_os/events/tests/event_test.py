

from src.roxira_os.events.event import Event
from src.roxira_os.events.event_bus import EventBus
from src.roxira_os.events.message_queue import MessageQueue



bus=EventBus()



bus.subscribe(
"customer.created",
lambda data:
{
"finance":"updated",
"customer":data
}
)



event=Event(
"customer.created",
{
"id":1001,
"name":"Ali"
}
)



print(
event.to_dict()
)



print(
bus.publish(
event
)
)



queue=MessageQueue()


queue.push(
event.to_dict()
)


print(
queue.consume()
)


print(
queue.size()
)

