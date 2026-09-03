

class LegalActionPlanner:


    def plan(self, issues):


        actions=[]


        if "official_deed_transfer" in issues:

            actions.extend([

                "ارسال اظهارنامه",
                "ثبت دادخواست الزام به تنظیم سند رسمی",
                "درخواست تامین خواسته"

            ])


        return {

            "actions":actions,

            "status":"ACTION_PLAN_READY"

        }

