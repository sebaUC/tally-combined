import { Global, Module } from '@nestjs/common';
import { ChannelLinkCodeService } from './utils/channel-link-code.service';
import { DataParserService } from './utils/data-parser.service';

@Global()
@Module({
  providers: [ChannelLinkCodeService, DataParserService],
  exports: [ChannelLinkCodeService, DataParserService],
})
export class CommonModule {}
