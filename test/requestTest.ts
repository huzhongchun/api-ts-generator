import { postPacketInterfacePanelgetOrderList } from '../api';

postPacketInterfacePanelgetOrderList({ page: 1, limit: 10 })
  .then(res => {
    console.log(res);
  })
  .catch(e => {
    console.log(111111);
    console.log(e);
  });
