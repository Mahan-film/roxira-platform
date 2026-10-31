import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  GLOBAL_GUARD_PROVIDERS,
  globalThrottlerModule,
} from '../../../security/global-guards';
import { UserRole } from '../../auth/enums/user-role.enum';
import { accessTestProviders } from '../../../test/support/access-stub';
import { INQUIRY_THROTTLE } from '../constants/inquiries.constants';
import { InquiriesService } from '../services/inquiries.service';
import { InquiriesController } from './inquiries.controller';

const SECRET = 'fake-secret-for-inquiries-spec-x';

describe('InquiriesController (rate limit + admin listing)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [globalThrottlerModule, JwtModule.register({ secret: SECRET })],
      controllers: [InquiriesController],
      providers: [
        {
          provide: InquiriesService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 1 }),
            list: jest.fn().mockResolvedValue({
              data: [],
              total: 0,
              page: 1,
              limit: 20,
            }),
          },
        },
        ...accessTestProviders().providers,
        ...GLOBAL_GUARD_PROVIDERS,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (role: UserRole) =>
    jwt.sign({ sub: 'u1', phone: '09120000000', role, domain: 'ROXIRA' });

  const payload = {
    name: 'سارا محمدی',
    company: 'شرکت فناوری روکسیرا',
    phone: '09121234567',
    email: 'sara@example.com',
  };

  it('allows the public inquiry endpoint up to the limit, then throttles (429)', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < INQUIRY_THROTTLE.limit; i += 1) {
      await request(server)
        .post('/enterprise/inquiries')
        .send(payload)
        .expect(201);
    }
    await request(server)
      .post('/enterprise/inquiries')
      .send(payload)
      .expect(429);
  });

  it('protects the admin listing: 401 without token, 403 for non-admin, 200 for admin', async () => {
    const server = app.getHttpServer();
    await request(server).get('/enterprise/inquiries').expect(401);
    await request(server)
      .get('/enterprise/inquiries')
      .set('Authorization', `Bearer ${token(UserRole.USER)}`)
      .expect(403);
    await request(server)
      .get('/enterprise/inquiries')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
  });
});
