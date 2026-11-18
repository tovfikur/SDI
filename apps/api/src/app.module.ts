import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthController } from './auth.controller';
import { HrController } from './hr.controller';
import { AttendanceController } from './attendance.controller';
import { LeaveController } from './leave.controller';
import { ProjectsController } from './projects.controller';
import { TrainingController } from './training.controller';
import { AuditController } from './audit.controller';
import { FilesController } from './files.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { FieldTrackingController } from './field-tracking.controller';
import { GeofenceController } from './geofence.controller';
import { PayrollController } from './payroll.controller';
import { TodosController } from './todos.controller';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { BrandingController } from './branding.controller';
import { SecurityController } from './security.controller';
import { RequestIdMiddleware } from './request-id.middleware';
import { GlobalAuthGuard } from './auth/global.guard';
import { DeletePasswordGuard } from './auth/delete-password.guard';
import { AuditInterceptor } from './audit.interceptor';

@Module({
  controllers: [
    AppController,
    AuthController,
    HrController,
    AttendanceController,
    LeaveController,
    ProjectsController,
    TrainingController,
    AuditController,
    FilesController,
    NotificationsController,
    FieldTrackingController,
    GeofenceController,
    PayrollController,
    TodosController,
    BrandingController,
    SecurityController,
    MessagesController,
  ],
  providers: [
    NotificationsGateway,
    MessagesGateway,
    {
      provide: APP_GUARD,
      useClass: GlobalAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DeletePasswordGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
