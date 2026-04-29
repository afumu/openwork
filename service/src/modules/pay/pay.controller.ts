import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PayService } from './pay.service';

@Controller('pay')
@ApiTags('pay')
export class PayController {
  constructor(private readonly payService: PayService) {}

  @Post('notify')
  @ApiOperation({ summary: 'hupi支付结果通知' })
  notifyHupi(@Body() body) {
    return this.payService.notify(body);
  }

  @Post('notify')
  @ApiOperation({ summary: 'Dulu支付结果通知' })
  notifyDuluPay(@Body() body) {
    return this.payService.notify(body);
  }

  @Post('notify')
  @ApiOperation({ summary: 'ltzf支付结果通知' })
  notifyLtzf(@Body() body) {
    return this.payService.notify(body);
  }

  @Get('notify')
  @ApiOperation({ summary: 'Epay支付结果通知' })
  notifyEpay(@Query() query) {
    return this.payService.notify(query);
  }
}
