import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 10, description: '应用ID', required: false })
  @IsOptional()
  appId: number;

  @ApiProperty({
    example: '',
    description: '对话模型配置项序列化的字符串',
    required: false,
  })
  modelConfig?: any;

  @ApiProperty({
    example: '',
    description: '对话组参数序列化的字符串',
    required: false,
  })
  params?: string;

  @ApiProperty({
    example: 'chat',
    description: '对话组类型：chat 普通对话，project 项目',
    required: false,
  })
  groupType?: 'chat' | 'project';
}
