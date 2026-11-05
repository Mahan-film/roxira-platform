import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateProjectDto, ProjectListResponseDto, ProjectResponseDto, QueryProjectsDto, UpdateProjectDto } from '../dto/project.dto';
import { ProjectService } from '../services/project.service';

/** Projects (پروژه) of the contracting module. The tenant comes only from the verified JWT claim. */
@ApiTags('Contracting - پروژه')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/contracting/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست پروژه‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: ProjectListResponseDto })
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryProjectsDto): Promise<ProjectListResponseDto> {
    return this.projects.list(requireTenantId(request), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'یک پروژه' })
  @ApiResponse({ status: HttpStatus.OK, type: ProjectResponseDto })
  getById(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<ProjectResponseDto> {
    return this.projects.getById(requireTenantId(request), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت پروژه' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ProjectResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateProjectDto): Promise<ProjectResponseDto> {
    return this.projects.create(requireTenantId(request), dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'ویرایش پروژه (کد تغییرپذیر نیست)' })
  @ApiResponse({ status: HttpStatus.OK, type: ProjectResponseDto })
  update(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    return this.projects.update(requireTenantId(request), id, dto);
  }
}
