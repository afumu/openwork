import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class DiscussionTurnParticipantDto {
  @ApiProperty({ description: '参与者 ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: '参与者类型', enum: ['host', 'expert', 'user'] })
  @IsString()
  @IsIn(['host', 'expert', 'user'])
  participantType: 'host' | 'expert' | 'user';

  @ApiProperty({ description: '展示名称' })
  @IsString()
  displayName: string;

  @ApiProperty({ description: '角色摘要' })
  @IsString()
  roleSummary: string;

  @ApiProperty({ description: '所属机构', required: false })
  @IsOptional()
  @IsString()
  organization?: string;

  @ApiProperty({ description: '专业视角', required: false })
  @IsOptional()
  @IsString()
  perspective?: string;

  @ApiProperty({ description: '立场倾向', required: false })
  @IsOptional()
  @IsString()
  stance?: string;

  @ApiProperty({ description: '当前轮次的人设 prompt', required: false })
  @IsOptional()
  @IsString()
  personaPrompt?: string;

  @ApiProperty({ description: '加入轮次', default: 1 })
  @IsInt()
  @Min(0)
  joinRound: number;
}

class DiscussionTurnMessageDto {
  @ApiProperty({ description: '消息所属参与者 ID' })
  @IsString()
  participantId: string;

  @ApiProperty({ description: '参与者类型', enum: ['host', 'expert', 'user'] })
  @IsString()
  @IsIn(['host', 'expert', 'user'])
  participantType: 'host' | 'expert' | 'user';

  @ApiProperty({
    description: '消息类型',
    enum: [
      'host_opening',
      'expert_message',
      'user_interrupt',
      'expert_join_notice',
      'discussion_summary',
      'agent_status',
    ],
  })
  @IsString()
  @IsIn([
    'host_opening',
    'expert_message',
    'user_interrupt',
    'expert_join_notice',
    'discussion_summary',
    'agent_status',
  ])
  messageType:
    | 'host_opening'
    | 'expert_message'
    | 'user_interrupt'
    | 'expert_join_notice'
    | 'discussion_summary'
    | 'agent_status';

  @ApiProperty({ description: '消息内容' })
  @IsString()
  content: string;

  @ApiProperty({ description: '轮次索引' })
  @IsInt()
  @Min(0)
  roundIndex: number;
}

export class DiscussionTurnDto {
  @ApiProperty({ description: '房间 ID', required: false })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiProperty({ description: '讨论主题' })
  @IsString()
  topic: string;

  @ApiProperty({ description: '主题补充说明', required: false })
  @IsOptional()
  @IsString()
  topicContext?: string;

  @ApiProperty({ description: '讨论目标', required: false })
  @IsOptional()
  @IsString()
  goal?: string;

  @ApiProperty({ description: '回复长度', enum: ['brief', 'balanced', 'deep'] })
  @IsString()
  @IsIn(['brief', 'balanced', 'deep'])
  responseLength: 'brief' | 'balanced' | 'deep';

  @ApiProperty({ description: '当前轮次', default: 1 })
  @IsInt()
  @Min(1)
  currentRound: number;

  @ApiProperty({ description: '最大轮数', default: 4 })
  @IsInt()
  @Min(1)
  @Max(20)
  maxRounds: number;

  @ApiProperty({ description: '是否首轮生成', required: false, default: false })
  @IsOptional()
  initial?: boolean;

  @ApiProperty({ description: '用户本轮补充问题', required: false })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({ description: '参与者列表', type: [DiscussionTurnParticipantDto] })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => DiscussionTurnParticipantDto)
  participants: DiscussionTurnParticipantDto[];

  @ApiProperty({ description: '最近消息历史', type: [DiscussionTurnMessageDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DiscussionTurnMessageDto)
  messages?: DiscussionTurnMessageDto[];
}
