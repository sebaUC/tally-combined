import { Global, Module } from '@nestjs/common';
import { ChannelLinkCodeService } from './utils/channel-link-code.service';
import { DataParserService } from './utils/data-parser.service';
import { AiWarmupService } from './services/ai-warmup.service';

@Global()
@Module({
  providers: [ChannelLinkCodeService, DataParserService, AiWarmupService],
  exports: [ChannelLinkCodeService, DataParserService, AiWarmupService],
})
export class CommonModule {}
