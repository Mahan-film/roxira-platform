class ProviderRuntime:


    def __init__(self):

        self.providers={}


    def register(self,name,provider):

        self.providers[name]=provider


    def execute(self,name,request):

        provider=self.providers.get(name)

        if not provider:

            return {

                "status":"PROVIDER_NOT_FOUND"

            }


        return provider.execute(request)
