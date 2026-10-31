import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { AccessRequest } from '../access-context';
import { AccessModule } from '../catalogue';
import { AuthOnly, ModuleAccess } from '../decorators';
import { AcceptInvitationDto } from '../dto/org.dto';
import { InvitationsService } from '../services/invitations.service';

/** Joining an organisation by invitation. Preview is public; accepting needs a signed-in account. */
@ApiTags('Invitations')
@ModuleAccess(AccessModule.MEMBERS)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @ApiBearerAuth()
  @AuthOnly()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(@Req() req: AccessRequest, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(req.user!.sub, dto.token, req);
  }
}
